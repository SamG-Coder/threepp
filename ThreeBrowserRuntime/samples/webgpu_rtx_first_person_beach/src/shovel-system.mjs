import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCarryableObject } from "./carryable-system.mjs";
import { createFirstPersonShovelHands } from "./first-person-hands.mjs";

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
  const hands = createFirstPersonShovelHands();
  return createCarryableObject({
    scene,
    camera,
    object: anchor,
    view,
    collisionWorld,
    spawn: { x: 1, z: -16.3, yaw: -0.2 },
    heldPosition: [0.46, -1.1, -1.18],
    heldScale: 0.7,
    heldRotation: [-0.07, 0.03, -0.2],
    heldVisual: hands,
    label: "shovel",
  });
}
