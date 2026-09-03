import * as THREE from "three/webgpu";

const worldPosition = new THREE.Vector3();
const bounds = new THREE.Box3();

function removeCollider(colliders, collider) {
  if (!collider) return;
  const index = colliders.indexOf(collider);
  if (index >= 0) colliders.splice(index, 1);
}

export function canInteractWithCarryable(view, objectX, objectZ, reach = 2.35) {
  const dx = objectX - view.x;
  const dz = objectZ - view.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach) return false;
  if (distance < 0.7) return true;
  const facingX = -Math.sin(view.yaw);
  const facingZ = -Math.cos(view.yaw);
  return (dx * facingX + dz * facingZ) / Math.max(1e-6, distance) > 0.12;
}

export function carryableDropPoint(view, distance = 1.35) {
  return {
    x: view.x - Math.sin(view.yaw) * distance,
    z: view.z - Math.cos(view.yaw) * distance,
  };
}

export function createCarryableObject({
  scene,
  camera,
  object,
  view,
  collisionWorld,
  spawn,
  heldPosition = [0.44, -1.08, -1.16],
  heldScale = 0.7,
  heldRotation = [-0.08, 0.04, -0.2],
  heldVisual = null,
  label = "object",
}) {
  const colliders = collisionWorld?.colliders ?? [];
  const baseScale = object.scale.clone();
  let carried = false;
  let collider = null;
  let elapsed = 0;

  function syncHeldVisual() {
    if (!heldVisual) return;
    heldVisual.position.copy(object.position);
    heldVisual.rotation.copy(object.rotation);
    heldVisual.scale.copy(object.scale);
  }

  function placeOnGround(x, z, yaw = 0) {
    scene.add(object);
    object.scale.copy(baseScale);
    object.rotation.set(0, yaw, 0);
    object.position.set(x, 0, z);
    object.updateMatrixWorld(true);
    bounds.setFromObject(object);
    const ground = collisionWorld.groundHeightAt(x, z);
    object.position.y += ground - bounds.min.y + 0.006;
    object.updateMatrixWorld(true);
    bounds.setFromObject(object);
    collider = {
      kind: label,
      shape: "box",
      box: bounds.clone(),
      minY: bounds.min.y,
      maxY: bounds.max.y,
      dynamicCarryable: true,
    };
    colliders.push(collider);
  }

  function pickUp() {
    removeCollider(colliders, collider);
    collider = null;
    camera.add(object);
    object.position.fromArray(heldPosition);
    object.rotation.fromArray(heldRotation);
    object.scale.copy(baseScale).multiplyScalar(heldScale);
    if (heldVisual) {
      camera.add(heldVisual);
      heldVisual.visible = true;
      syncHeldVisual();
    }
    object.updateMatrixWorld(true);
    carried = true;
    elapsed = 0;
    console.log(`[First-Person Beach] Picked up ${label} · E to drop`);
  }

  function drop() {
    const point = carryableDropPoint(view);
    carried = false;
    if (heldVisual) {
      heldVisual.visible = false;
      heldVisual.removeFromParent();
    }
    placeOnGround(point.x, point.z, view.yaw + Math.PI);
    console.log(`[First-Person Beach] Dropped ${label} · E to pick up`);
  }

  placeOnGround(spawn.x, spawn.z, spawn.yaw ?? 0);

  return {
    object,
    get carried() {
      return carried;
    },
    interact() {
      if (carried) {
        drop();
        return true;
      }
      object.getWorldPosition(worldPosition);
      if (!canInteractWithCarryable(view, worldPosition.x, worldPosition.z)) return false;
      pickUp();
      return true;
    },
    update(dt) {
      if (!carried) return;
      elapsed += dt;
      const moving = Math.min(1, Math.max(0, view.speed / 5.7));
      const gait = elapsed * (5.4 + moving * 4.2);
      const bob = Math.sin(gait) * 0.012 * moving;
      const sway = Math.sin(gait * 0.5) * 0.009 * moving;
      object.position.set(
        heldPosition[0] + sway,
        heldPosition[1] + bob,
        heldPosition[2],
      );
      object.rotation.set(
        heldRotation[0] + bob * 0.45,
        heldRotation[1],
        heldRotation[2] - sway * 0.55,
      );
      syncHeldVisual();
    },
    dispose() {
      removeCollider(colliders, collider);
      object.removeFromParent();
      object.traverse(child => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.());
        else child.material?.dispose?.();
      });
      if (heldVisual) {
        heldVisual.removeFromParent();
        heldVisual.traverse(child => child.geometry?.dispose?.());
        const materials = heldVisual.userData.materials ?? {};
        for (const material of Object.values(materials)) material.dispose?.();
      }
    },
  };
}
