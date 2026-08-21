import { Euler, Vector3, MathUtils } from 'three/webgpu';

const MAX_PITCH = Math.PI / 2 - 0.01;

// Unreal-viewport-style free camera: hold right mouse to look, WASD to fly
// (along the view direction, pitch included), Q/E down/up, shift to boost,
// wheel to change fly speed.
//
// Not addons/FlyControls — it rolls the horizon on Q/E (fatal when
// the horizon is the whole shot) and binds R/F, colliding with the F
// debug-view key. Yaw/pitch only, so the horizon stays level.
export function createFlyCamera(camera, dom, { speed = 25, lookSpeed = 0.0022 } = {}) {
  const keys = new Set();
  const euler = new Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion);
  const dir = new Vector3();
  let looking = false;
  let moveSpeed = speed;

  const axis = (pos, neg) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    looking = true;
    Promise.resolve(dom.requestPointerLock()).catch(() => {}); // rate-limited on fast re-click
  });
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    moveSpeed = MathUtils.clamp(moveSpeed * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5, 800);
  }, { passive: false });

  addEventListener('mouseup', (e) => {
    if (e.button !== 2) return;
    looking = false;
    document.exitPointerLock();
  });
  addEventListener('mousemove', (e) => {
    if (!looking) return;
    euler.y -= e.movementX * lookSpeed;
    euler.x = MathUtils.clamp(euler.x - e.movementY * lookSpeed, -MAX_PITCH, MAX_PITCH);
  });
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear()); // alt-tab must not leave a key stuck
  // Esc drops the pointer lock without a mouseup — stop looking, or the next
  // mousemove yanks the camera
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) looking = false;
  });

  const update = (dt) => {
    camera.quaternion.setFromEuler(euler);
    dir.set(axis('KeyD', 'KeyA'), 0, axis('KeyS', 'KeyW'));
    dir.normalize().applyQuaternion(camera.quaternion);
    dir.y += axis('KeyE', 'KeyQ'); // up/down is world-space, never camera-space
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
    camera.position.addScaledVector(dir.normalize(), moveSpeed * boost * dt);
  };

  return { update, get speed() { return moveSpeed; } };
}
