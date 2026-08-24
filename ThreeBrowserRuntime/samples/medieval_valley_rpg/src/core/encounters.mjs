import * as THREE from "three/webgpu";

const BASELINE_SPAWNS = Object.freeze([
  ["wolf", -72, -96, "resin-grove"],
  ["wolf", -81, -108, "resin-grove"],
  ["wolf", -62, -106, "resin-grove"],
  ["wolf", 96, -72, "east-wood"],
  ["wolf", 107, -82, "east-wood"],
  ["hollowSoldier", -9, -116, "north-road"],
  ["hollowSoldier", 8, -129, "north-road"],
  ["brute", 112, -91, "shadow-cave"],
]);

function alive(enemy) {
  return enemy?.active && enemy.alive !== false && !enemy.combat?.isDead?.();
}

/** Coordinates quest encounters while the EnemyDirector owns AI and pooling. */
export function createEncounterCoordinator({ world, enemies, quests, progression, events }) {
  let baselineSpawned = false;
  let defenseStarted = false;
  let defenseWave = 0;
  let nextWaveDelay = 0;
  let wardenSpawned = false;
  let northernReinforcements = false;
  let nightSpawnCooldown = 16;

  function position(x, z) {
    return new THREE.Vector3(x, world.terrainHeight(x, z), z);
  }

  function spawn(archetype, x, z, tag, level = 1) {
    const enemy = enemies.spawn(archetype, {
      position: position(x, z),
      home: position(x, z),
      yaw: Math.atan2(-x, z),
      level,
    });
    if (enemy) enemy.encounterTag = tag;
    return enemy;
  }

  function spawnBaseline() {
    if (baselineSpawned) return;
    baselineSpawned = true;
    for (const [archetype, x, z, tag] of BASELINE_SPAWNS) spawn(archetype, x, z, tag);
  }

  function spawnDefenseWave() {
    defenseWave += 1;
    const count = defenseWave === 1 ? 3 : defenseWave === 2 ? 4 : 5;
    for (let index = 0; index < count; ++index) {
      const side = index % 2 ? -1 : 1;
      const x = side * (29 + index * 3.5);
      const z = 66 + Math.floor(index / 2) * 6;
      const archetype = defenseWave === 3 && index === count - 1 ? "hollowSoldier" : "wolf";
      spawn(archetype, x, z, "village-defense", 1 + defenseWave * 0.15);
    }
    events?.emit?.("encounter:wave", { encounter: "village-defense", wave: defenseWave, count });
  }

  function update(delta, player, timeState = {}, weatherState = {}) {
    spawnBaseline();
    const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
    const main = quests.get("light_against_the_dark");

    if (main.stageId === "defend_repairs") {
      if (!defenseStarted) {
        defenseStarted = true;
        defenseWave = 0;
        nextWaveDelay = 2.5;
        events?.emit?.("encounter:defense-start", { encounter: "village-defense" });
      }
      const attackers = enemies.active().filter(enemy => enemy.encounterTag === "village-defense" && alive(enemy));
      if (attackers.length === 0) {
        nextWaveDelay -= dt;
        if (nextWaveDelay <= 0 && defenseWave < 3) {
          spawnDefenseWave();
          nextWaveDelay = 4;
        } else if (defenseWave >= 3) {
          quests.notify({ type: "defend", target: "beacon_repair_site", amount: 1 });
          events?.emit?.("encounter:defense-complete", { encounter: "village-defense", waves: defenseWave });
        }
      }
    }

    const playerPosition = player?.root?.position;
    if (progression.get("fortressRouteUnlocked") && !northernReinforcements && playerPosition?.z < -92) {
      northernReinforcements = true;
      spawn("hollowSoldier", -13, -145, "fortress-road", 1.2);
      spawn("hollowSoldier", 14, -151, "fortress-road", 1.2);
    }

    if (main.stageId === "defeat_warden" && !wardenSpawned && playerPosition &&
        playerPosition.distanceToSquared(position(0, -190)) < 58 * 58) {
      wardenSpawned = true;
      const warden = spawn("fortressWarden", 0, -202, "fortress-boss", 1);
      events?.emit?.("encounter:boss-start", { boss: warden });
    }

    nightSpawnCooldown -= dt;
    const dangerousNight = timeState.phase === "night" && Number(weatherState.enemyAggression ?? 1) > 1.05;
    if (dangerousNight && nightSpawnCooldown <= 0 && playerPosition && playerPosition.z < 95 &&
        enemies.active("wolf").filter(alive).length < 8) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 22 + Math.random() * 12;
      spawn("wolf", playerPosition.x + Math.cos(angle) * radius,
        playerPosition.z + Math.sin(angle) * radius, "night-roamer", 1.1);
      nightSpawnCooldown = 28;
    }
  }

  return {
    update,
    spawn,
    snapshot() {
      return {
        baselineSpawned,
        defenseStarted,
        defenseWave,
        wardenSpawned,
        activeEnemies: enemies.active().filter(alive).length,
      };
    },
  };
}
