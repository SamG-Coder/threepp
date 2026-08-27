import * as THREE from "three/webgpu";

export function createDowntownCamera(camera, player, input, world) {
  const currentPosition = new THREE.Vector3();
  const currentLook = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  let ready = false;
  let fly = false;
  let yaw = Math.PI;
  let pitch = 0;

  camera.fov = 44;
  camera.near = 0.12;
  camera.far = 250;
  camera.updateProjectionMatrix();

  function enterFly() {
    fly = true;
    input.setFlyMode(true);
    euler.setFromQuaternion(camera.quaternion, "YXZ");
    pitch = euler.x;
    yaw = euler.y;
    console.log("[Neon Downtown] camera=inspection fly · D right · A left · Space up · Ctrl down");
  }

  function leaveFly() {
    fly = false;
    input.setFlyMode(false);
    ready = false;
    console.log("[Neon Downtown] camera=side-on character follow");
  }

  return {
    get flyMode() {
      return fly;
    },
    resize(width, height) {
      camera.aspect = Math.max(0.45, width / Math.max(1, height));
      camera.updateProjectionMatrix();
    },
    update(delta) {
      if (input.consume("KeyF")) {
        if (fly) leaveFly();
        else enterFly();
      }

      if (fly) {
        const mouse = input.takeMouseDelta();
        yaw -= mouse.x * 0.0021;
        pitch = THREE.MathUtils.clamp(pitch - mouse.y * 0.0018, -1.48, 1.48);
        camera.rotation.set(pitch, yaw, 0, "YXZ");
        camera.getWorldDirection(forward);
        right.crossVectors(forward, up).normalize();
        const axis = input.flyAxis();
        const speed = (axis.boost ? 18 : 6.5) * Math.max(0, delta);
        camera.position.addScaledVector(forward, axis.forward * speed);
        camera.position.addScaledVector(right, axis.x * speed);
        camera.position.y += axis.vertical * speed;
        camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.35, 55);
        camera.position.x = THREE.MathUtils.clamp(camera.position.x, world.minX - 24, world.maxX + 24);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, -34, 132);
        return;
      }

      const origin = player.position;
      const velocity = player.velocity;
      const leadX = Number(velocity?.x || 0) / 6.4;
      desiredPosition.set(
        THREE.MathUtils.clamp(origin.x + leadX, world.minX + 17, world.maxX - 17),
        3.6,
        -12.8,
      );
      desiredLook.set(
        THREE.MathUtils.clamp(origin.x + Number(velocity?.x || 0) / 8.2, world.minX + 17, world.maxX - 17),
        6.1,
        13.8,
      );
      const positionSmoothing = 1 - Math.exp(-Math.max(0, delta) * 6.4);
      const lookSmoothing = 1 - Math.exp(-Math.max(0, delta) * 8.2);
      if (!ready) {
        currentPosition.copy(desiredPosition);
        currentLook.copy(desiredLook);
        ready = true;
      } else {
        currentPosition.lerp(desiredPosition, positionSmoothing);
        currentLook.lerp(desiredLook, lookSmoothing);
      }
      camera.position.copy(currentPosition);
      camera.lookAt(currentLook);
    },
  };
}
