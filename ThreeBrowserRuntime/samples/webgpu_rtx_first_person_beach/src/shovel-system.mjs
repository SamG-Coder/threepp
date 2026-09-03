import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCarryableObject } from "./carryable-system.mjs";

export async function createBeachShovel(scene, camera, view, collisionWorld) {
  const loader = new GLTFLoader();
  const url = new URL("../assets/models/detailed-beach-shovel.glb", import.meta.url).href;
  const gltf = await loader.loadAsync(url);
  const anchor = new THREE.Group();
  anchor.name = "Carryable detailed beach shovel";
  anchor.userData.rtxIgnore = true;
  anchor.add(gltf.scene);
  gltf.scene.traverse(object => {
    if (object.userData.studioVisible === false) {
      object.visible = false;
      return;
    }
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.rtxIgnore = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      material.envMapIntensity = 0.9;
      material.needsUpdate = true;
    }
  });
  return createCarryableObject({
    scene,
    camera,
    object: anchor,
    view,
    collisionWorld,
    spawn: { x: 1, z: -16.3, yaw: -0.2 },
    // Ready-to-dig pose: blade close at the left, shaft receding across the
    // lower view, and the handle clear of the aiming centre.
    heldPosition: [-0.58, 0.06, -0.68],
    heldScale: 0.82,
    heldRotation: [-0.18, 0.12, -2.02],
    label: "shovel",
  });
}
