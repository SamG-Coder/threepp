import * as THREE from "three/webgpu";

const LOOT_ALIASES = Object.freeze({
  "wolf-pelt": "leather",
  "raw-meat": "medicinal_herbs",
  "old-coin": "gold",
  "iron-scrap": "iron_ingot",
  "brute-token": "monster_fang",
  "steel-ingot": "iron_ingot",
  "warden-sigil": "warden_sigil",
  "fortress-key": "gold",
});

function actorPosition(actor) {
  return actor?.root?.position ?? actor?.position ?? actor?.object3D?.position ?? null;
}

function randomQuantity(value) {
  if (Array.isArray(value)) {
    const minimum = Math.max(1, Math.trunc(Number(value[0]) || 1));
    const maximum = Math.max(minimum, Math.trunc(Number(value[1]) || minimum));
    return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  }
  return Math.max(1, Math.trunc(Number(value) || 1));
}

function orientCylinder(mesh, direction) {
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
}

/**
 * Pooled projectiles and world-space loot. These are deliberately dynamic and
 * excluded from the immutable RTX scene while still participating in combat.
 */
export function createRuntimeServices({ world, actors, events, inventory, economy }) {
  const root = new THREE.Group();
  root.name = "Pooled projectiles and loot";
  root.userData.rtxIgnore = true;
  world.addDynamicActor?.(root) ?? world.scene?.add?.(root);

  const boltGeometry = new THREE.CylinderGeometry(0.025, 0.04, 0.72, 7);
  const boltMaterial = new THREE.MeshStandardMaterial({ color: 0x39291e, roughness: 0.8, metalness: 0.1 });
  const lootGeometry = new THREE.OctahedronGeometry(0.22, 0);
  const lootMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7a94f,
    emissive: 0x3a2107,
    emissiveIntensity: 1.1,
    roughness: 0.42,
    metalness: 0.24,
  });
  const projectilePool = [];
  const lootPool = [];
  const temp = new THREE.Vector3();
  let player = null;
  let elapsed = 0;

  function acquireProjectile() {
    let projectile = projectilePool.find(entry => !entry.active);
    if (!projectile) {
      const mesh = new THREE.Mesh(boltGeometry, boltMaterial);
      mesh.name = "Pooled crossbow bolt";
      mesh.castShadow = true;
      mesh.userData.rtxIgnore = true;
      root.add(mesh);
      projectile = { mesh, active: false, velocity: new THREE.Vector3(), travelled: 0 };
      projectilePool.push(projectile);
    }
    return projectile;
  }

  function spawnProjectile(descriptor) {
    const projectile = acquireProjectile();
    projectile.active = true;
    projectile.mesh.visible = true;
    projectile.mesh.position.copy(descriptor.origin);
    projectile.velocity.copy(descriptor.direction).normalize().multiplyScalar(Number(descriptor.speed) || 40);
    orientCylinder(projectile.mesh, projectile.velocity.clone().normalize());
    projectile.travelled = 0;
    projectile.range = Math.max(1, Number(descriptor.range) || 50);
    projectile.damage = Math.max(0, Number(descriptor.damage) || 0);
    projectile.poiseDamage = Math.max(0, Number(descriptor.poiseDamage) || 0);
    projectile.source = descriptor.source;
    projectile.team = descriptor.team;
    projectile.attackId = descriptor.attackId;
    return projectile;
  }

  function retireProjectile(projectile) {
    projectile.active = false;
    projectile.mesh.visible = false;
    projectile.source = null;
  }

  function acquireLoot() {
    let drop = lootPool.find(entry => !entry.active);
    if (!drop) {
      const mesh = new THREE.Mesh(lootGeometry, lootMaterial);
      mesh.name = "Pooled glowing loot pickup";
      mesh.castShadow = true;
      mesh.userData.rtxIgnore = true;
      root.add(mesh);
      drop = { mesh, active: false, baseY: 0, age: 0 };
      lootPool.push(drop);
    }
    return drop;
  }

  function resolveLoot(table) {
    const rewards = [];
    for (const entry of table ?? []) {
      if (Math.random() > Number(entry.chance ?? 1)) continue;
      const rawId = entry.itemId ?? entry.item;
      const itemId = LOOT_ALIASES[rawId] ?? rawId;
      rewards.push({ itemId, quantity: randomQuantity(entry.quantity) });
    }
    return rewards;
  }

  function spawnLoot({ position, table, source }) {
    const rewards = resolveLoot(table);
    if (rewards.length === 0) return null;
    const drop = acquireLoot();
    drop.active = true;
    drop.mesh.visible = true;
    drop.mesh.position.copy(position);
    drop.baseY = Math.max(world.terrainHeight(position.x, position.z) + 0.42, position.y + 0.25);
    drop.mesh.position.y = drop.baseY;
    drop.age = 0;
    drop.rewards = rewards;
    drop.source = source;
    return drop;
  }

  function collect(drop) {
    const received = [];
    for (const reward of drop.rewards) {
      if (reward.itemId === "gold") {
        economy.addGold(reward.quantity * 4, "loot");
        received.push(`${reward.quantity * 4} gold`);
        continue;
      }
      try {
        const result = inventory.add(reward.itemId, reward.quantity, "loot");
        if (result.added) received.push(`${reward.itemId} x${result.added}`);
      } catch (error) {
        console.warn(`[Medieval RPG] skipped unknown loot ${reward.itemId}: ${error?.message || error}`);
      }
    }
    drop.active = false;
    drop.mesh.visible = false;
    events?.emit?.("loot:collected", { rewards: drop.rewards, received, source: drop.source });
  }

  function update(delta) {
    const dt = Math.min(0.05, Math.max(0, Number(delta) || 0));
    elapsed += dt;
    for (const projectile of projectilePool) {
      if (!projectile.active) continue;
      temp.copy(projectile.velocity).multiplyScalar(dt);
      projectile.mesh.position.add(temp);
      projectile.travelled += temp.length();
      const candidates = actors.queryRadius(projectile.mesh.position, 0.48, {
        attacker: projectile.source,
        team: projectile.team,
      });
      const target = candidates.find(candidate => candidate !== projectile.source && candidate.alive !== false);
      if (target) {
        const hit = {
          source: projectile.source,
          attackId: projectile.attackId,
          weapon: "crossbow",
          kind: "projectile",
          damage: projectile.damage,
          poiseDamage: projectile.poiseDamage,
          direction: projectile.velocity.clone().normalize(),
          point: projectile.mesh.position.clone(),
          staggerDuration: 0.48,
        };
        const result = target.receiveHit?.(hit) ?? target.combat?.receiveHit?.(hit);
        events?.emit?.("combat:projectile-hit", { target, hit, result });
        retireProjectile(projectile);
        continue;
      }
      if (projectile.travelled >= projectile.range ||
          projectile.mesh.position.y <= world.terrainHeight(projectile.mesh.position.x, projectile.mesh.position.z) + 0.08) {
        retireProjectile(projectile);
      }
    }

    const playerPosition = actorPosition(player);
    for (let index = 0; index < lootPool.length; ++index) {
      const drop = lootPool[index];
      if (!drop.active) continue;
      drop.age += dt;
      drop.mesh.rotation.y += dt * 1.8;
      drop.mesh.position.y = drop.baseY + Math.sin(elapsed * 2.4 + index) * 0.1;
      if (playerPosition && drop.mesh.position.distanceToSquared(playerPosition) <= 1.8 * 1.8) collect(drop);
      else if (drop.age > 180) {
        drop.active = false;
        drop.mesh.visible = false;
      }
    }
  }

  function nearestInteractable(position, maximumDistance = 3.5) {
    let nearest = null;
    let nearestSquared = maximumDistance * maximumDistance;
    for (const interactable of world.interactables ?? []) {
      if (interactable.enabled === false) continue;
      temp.fromArray(interactable.position);
      const distanceSquared = temp.distanceToSquared(position);
      const radius = Math.max(maximumDistance, Number(interactable.radius) || 0);
      if (distanceSquared <= radius * radius && distanceSquared < nearestSquared) {
        nearest = interactable;
        nearestSquared = distanceSquared;
      }
    }
    return nearest;
  }

  return {
    projectiles: { spawn: spawnProjectile },
    loot: { spawn: spawnLoot },
    interactions: { nearest: nearestInteractable },
    setPlayer(value) { player = value; },
    update,
    snapshot() {
      return {
        projectiles: projectilePool.filter(entry => entry.active).length,
        loot: lootPool.filter(entry => entry.active).length,
      };
    },
    dispose() {
      root.removeFromParent();
      boltGeometry.dispose();
      lootGeometry.dispose();
      boltMaterial.dispose();
      lootMaterial.dispose();
      projectilePool.length = 0;
      lootPool.length = 0;
    },
  };
}
