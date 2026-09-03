import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createBeachCollisionWorld } from "../src/collision-system.mjs";
import { terrainHeight } from "../src/terrain.mjs";

test("palm trunks block and boxes support or slide a player capsule", () => {
  const dressing = new THREE.Group();
  const palm = new THREE.Group();
  palm.name = "Coconut palm";
  palm.position.set(0, terrainHeight(0, -18), -18);
  dressing.add(palm);

  const rockX = 5;
  const rockZ = -18;
  const rock = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.8));
  rock.name = "Shore rock - test";
  rock.position.set(rockX, terrainHeight(rockX, rockZ) + 0.5, rockZ);
  dressing.add(rock);
  dressing.updateWorldMatrix(true, true);

  const collision = createBeachCollisionWorld({ dressing, palms: [palm] });
  const trunkAttempt = collision.resolveMovement(
    -0.8, -18, -0.1, -18,
    terrainHeight(-0.8, -18),
  );
  assert.equal(trunkAttempt.x, -0.8, "palm cylinder blocks entry");

  const rockAttempt = collision.resolveMovement(
    rockX - 1.5, rockZ - 0.5, rockX, rockZ + 0.2,
    terrainHeight(rockX - 1.5, rockZ),
  );
  assert.equal(rockAttempt.x, rockX - 1.5, "rock blocks the colliding axis");
  assert.notEqual(rockAttempt.z, rockZ - 0.5, "free axis slides along the rock");
  const support = collision.surfaceAt(rockX, rockZ);
  assert.equal(support.kind, "rock");
  assert.ok(support.height > terrainHeight(rockX, rockZ));
});
