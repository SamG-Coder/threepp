import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCarryableObject } from "./carryable-system.mjs";

const READY_POSITION = new THREE.Vector3(-0.58, 0.06, -0.68);
const READY_ROTATION = new THREE.Euler(-0.18, 0.12, -2.02, "XYZ");
const HELD_SCALE = 0.82;
const SWING_START_POSITION = new THREE.Vector3(0.36, -0.12, -0.68);
const SWING_END_POSITION = new THREE.Vector3(-0.54, -0.38, -0.68);
const SHOULDER_POSITION = new THREE.Vector3(-0.38, 0.32, -0.42);
const SWING_START_ROTATION = new THREE.Euler(-0.24, 0.08, -0.58, "XYZ");
const SWING_END_ROTATION = new THREE.Euler(-0.12, 0.1, -1.62, "XYZ");
const SHOULDER_ROTATION = new THREE.Euler(-0.42, 0.18, -2.68, "XYZ");
// Trace far enough to learn which patch of ground the player is looking at,
// then constrain the actual strike to a believable first-person shovel reach.
const DIG_AIM_TRACE = 12;
const MAX_DIG_HORIZONTAL_REACH = 1.5;

const WINDUP_SECONDS = 0.2;
const SWING_SECONDS = 0.34;
const SHOULDER_SECONDS = 0.32;
const SHOULDER_HOLD_SECONDS = 0.1;
const RECOVER_SECONDS = 0.3;

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function createDigAnimation(object, camera, collisionWorld, isCarried, onDig) {
  const startPosition = new THREE.Vector3();
  const phaseStartPosition = new THREE.Vector3();
  const readyPosition = new THREE.Vector3();
  const aimOrigin = new THREE.Vector3();
  const aimDirection = new THREE.Vector3();
  const aimEnd = new THREE.Vector3();
  const reachableDirection = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  const startRotation = new THREE.Quaternion();
  const phaseStartRotation = new THREE.Quaternion();
  const readyRotation = new THREE.Quaternion();
  const swingStartRotation = new THREE.Quaternion().setFromEuler(SWING_START_ROTATION);
  const swingEndRotation = new THREE.Quaternion().setFromEuler(SWING_END_ROTATION);
  const shoulderRotation = new THREE.Quaternion().setFromEuler(SHOULDER_ROTATION);
  let phase = "idle";
  let phaseTime = 0;
  let targetKind = "terrain";

  function poseBetween(fromPosition, toPosition, fromRotation, toRotation, alpha) {
    object.position.lerpVectors(fromPosition, toPosition, alpha);
    object.quaternion.slerpQuaternions(fromRotation, toRotation, alpha);
    object.updateWorldMatrix(true, true);
  }

  function beginPhase(nextPhase) {
    phaseStartPosition.copy(object.position);
    phaseStartRotation.copy(object.quaternion);
    phase = nextPhase;
    phaseTime = 0;
  }

  function beginRecover() {
    beginPhase("recover");
  }

  return {
    get active() {
      return phase !== "idle";
    },
    trigger() {
      if (!isCarried() || phase !== "idle") return false;
      startPosition.copy(object.position);
      startRotation.copy(object.quaternion);
      camera.getWorldPosition(aimOrigin);
      camera.getWorldDirection(aimDirection);
      // Digging is deliberately a downward action. This also prevents a level
      // click from playing a disconnected shovel animation against empty air.
      if (aimDirection.y > -0.12) return false;
      aimEnd.copy(aimDirection).multiplyScalar(DIG_AIM_TRACE).add(aimOrigin);
      const aimedContact = collisionWorld.sweepPoint(aimOrigin, aimEnd, 0.035);
      if (aimedContact) {
        targetWorld.set(aimedContact.x, aimedContact.y, aimedContact.z);
        targetKind = aimedContact.kind;
      } else {
        targetWorld.copy(aimEnd);
        targetKind = "terrain";
      }

      // Preserve the aimed compass direction, but do not let a shallow view
      // turn a hand-held spade into a long-range tool. Steep downward views
      // naturally retain their closer ray/ground intersection.
      reachableDirection.set(targetWorld.x - aimOrigin.x, 0, targetWorld.z - aimOrigin.z);
      const horizontalDistance = reachableDirection.length();
      if (horizontalDistance > MAX_DIG_HORIZONTAL_REACH) {
        reachableDirection.multiplyScalar(MAX_DIG_HORIZONTAL_REACH / horizontalDistance);
        targetWorld.x = aimOrigin.x + reachableDirection.x;
        targetWorld.z = aimOrigin.z + reachableDirection.z;
        targetWorld.y = collisionWorld.groundHeightAt(targetWorld.x, targetWorld.z);
        targetKind = "terrain";
      }
      phase = "windup";
      phaseTime = 0;
      return true;
    },
    cancel() {
      phase = "idle";
      phaseTime = 0;
    },
    update(dt) {
      if (!isCarried()) {
        this.cancel();
        return;
      }
      if (phase === "idle") return;

      // The carryable controller has already supplied the current ready pose.
      readyPosition.copy(object.position);
      readyRotation.copy(object.quaternion);
      phaseTime += dt;

      if (phase === "windup") {
        const t = smoothstep01(phaseTime / WINDUP_SECONDS);
        poseBetween(startPosition, SWING_START_POSITION, startRotation, swingStartRotation, t);
        if (phaseTime >= WINDUP_SECONDS) beginPhase("swing");
        return;
      }

      if (phase === "swing") {
        const t = smoothstep01(phaseTime / SWING_SECONDS);
        poseBetween(phaseStartPosition, SWING_END_POSITION, phaseStartRotation, swingEndRotation, t);
        // Dip the middle of the right-to-left sweep so it reads as cutting
        // through sand rather than moving across a flat horizontal rail.
        object.position.y -= Math.sin(t * Math.PI) * 0.09;
        if (phaseTime >= SWING_SECONDS) {
          console.log(`[First-Person Beach] Shovel struck ${targetKind}`);
          if (targetKind === "terrain") {
            const horizontalLength = Math.hypot(aimDirection.x, aimDirection.z) || 1;
            onDig?.({
              x: targetWorld.x,
              y: targetWorld.y,
              z: targetWorld.z,
              forwardX: aimDirection.x / horizontalLength,
              forwardZ: aimDirection.z / horizontalLength,
            });
            beginPhase("shoulder");
          } else beginPhase("recover");
        }
        return;
      }

      if (phase === "shoulder") {
        const t = smoothstep01(phaseTime / SHOULDER_SECONDS);
        poseBetween(phaseStartPosition, SHOULDER_POSITION, phaseStartRotation, shoulderRotation, t);
        if (phaseTime >= SHOULDER_SECONDS) beginPhase("shoulderHold");
        return;
      }

      if (phase === "shoulderHold") {
        object.position.copy(SHOULDER_POSITION);
        object.quaternion.copy(shoulderRotation);
        if (phaseTime >= SHOULDER_HOLD_SECONDS) beginRecover();
        return;
      }

      const t = smoothstep01(phaseTime / RECOVER_SECONDS);
      poseBetween(phaseStartPosition, readyPosition, phaseStartRotation, readyRotation, t);
      if (phaseTime >= RECOVER_SECONDS) phase = "idle";
    },
  };
}

export async function createBeachShovel(scene, camera, view, collisionWorld, onDig = null) {
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
  const carryable = createCarryableObject({
    scene,
    camera,
    object: anchor,
    view,
    collisionWorld,
    spawn: { x: 1, z: -16.3, yaw: -0.2 },
    // Ready-to-dig pose: blade close at the left, shaft receding across the
    // lower view, and the handle clear of the aiming centre.
    heldPosition: READY_POSITION.toArray(),
    heldScale: HELD_SCALE,
    heldRotation: [READY_ROTATION.x, READY_ROTATION.y, READY_ROTATION.z],
    label: "shovel",
  });
  const digAnimation = createDigAnimation(
    anchor,
    camera,
    collisionWorld,
    () => carryable.carried,
    onDig,
  );
  return {
    object: carryable.object,
    get carried() {
      return carryable.carried;
    },
    get digging() {
      return digAnimation.active;
    },
    interact() {
      digAnimation.cancel();
      return carryable.interact();
    },
    dig() {
      return digAnimation.trigger();
    },
    update(dt) {
      carryable.update(dt);
      digAnimation.update(dt);
    },
    dispose() {
      digAnimation.cancel();
      carryable.dispose();
    },
  };
}
