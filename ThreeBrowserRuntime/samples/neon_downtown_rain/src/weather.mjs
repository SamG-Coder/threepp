import * as THREE from "three/webgpu";
import { loadCutout, loadMask } from "./assets.mjs";

function hash01(index, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function nearestNeonColor(x, buildings, neutral = 0x9fc9df) {
  let nearest = null;
  let distance = Infinity;
  for (const building of buildings) {
    const next = Math.abs(Number(building.x) - x);
    if (next < distance) {
      nearest = building;
      distance = next;
    }
  }
  return new THREE.Color(nearest?.light || neutral)
    .lerp(new THREE.Color(neutral), 0.62);
}

function makeRainStreaks(config, materials, geometries) {
  const count = 320;
  const positions = new Float32Array(count * 2 * 3);
  const colors = new Float32Array(count * 2 * 3);
  const drops = [];
  const minX = Number(config.world.minX) - 8;
  const maxX = Number(config.world.maxX) + 8;
  const minZ = Number(config.world.roadZ[0]) + 5;
  const maxZ = Number(config.world.facadeZ) + 3;
  const spanX = maxX - minX;
  for (let index = 0; index < count; index += 1) {
    const x = minX + hash01(index, 1) * spanX;
    const color = nearestNeonColor(x, config.buildings);
    drops.push({
      x,
      z: minZ + hash01(index, 2) * (maxZ - minZ),
      phase: hash01(index, 3) * 22,
      speed: 10.5 + hash01(index, 4) * 7.5,
      length: 0.32 + hash01(index, 5) * 0.72,
      wind: 0.7 + hash01(index, 6) * 0.45,
    });
    for (let vertex = 0; vertex < 2; vertex += 1) {
      const offset = (index * 2 + vertex) * 3;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.name = "Procedural world-space rain streak geometry";
  geometries.push(geometry);
  const material = new THREE.LineBasicNodeMaterial({
    name: "Procedural neon-lit rain effect",
    vertexColors: true,
    transparent: true,
    opacity: 0.24,
    depthTest: true,
    depthWrite: false,
    fog: true,
    toneMapped: true,
  });
  material.rtxReflectionMask = 0;
  material.userData.rtxIgnore = true;
  materials.push(material);
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "World-space procedural rain";
  lines.renderOrder = 31;
  lines.frustumCulled = false;
  lines.userData.proceduralWeatherEffect = true;

  function update(time) {
    const yTop = 20.5;
    const ySpan = 21.2;
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index];
      const travelled = time * drop.speed + drop.phase;
      const y = yTop - (travelled % ySpan);
      const x = minX + ((drop.x - minX + time * drop.wind) % spanX + spanX) % spanX;
      const offset = index * 6;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = drop.z;
      positions[offset + 3] = x + drop.length * 0.11;
      positions[offset + 4] = y + drop.length;
      positions[offset + 5] = drop.z;
    }
    geometry.attributes.position.needsUpdate = true;
  }

  return { lines, update };
}

function makePuddleImpacts(config, materials, geometries) {
  const count = 26;
  const ringGeometry = new THREE.RingGeometry(0.88, 1, 36);
  ringGeometry.rotateX(-Math.PI * 0.5);
  ringGeometry.name = "Procedural puddle impact ring";
  geometries.push(ringGeometry);
  const minX = Number(config.world.minX) + 4;
  const spanX = Number(config.world.maxX) - Number(config.world.minX) - 8;
  const impacts = [];
  for (let index = 0; index < count; index += 1) {
    const x = minX + hash01(index, 11) * spanX;
    const color = nearestNeonColor(x, config.buildings, 0xa9d9ea);
    const material = new THREE.MeshBasicNodeMaterial({
      name: "Procedural neon puddle ring " + (index + 1),
      color,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
      toneMapped: true,
    });
    material.rtxReflectionMask = 0;
    material.userData.rtxIgnore = true;
    materials.push(material);
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.name = "World puddle impact " + (index + 1);
    mesh.position.set(x, 0.048, -8.6 + hash01(index, 12) * 13.1);
    mesh.renderOrder = 8;
    mesh.frustumCulled = false;
    mesh.userData.proceduralWeatherEffect = true;
    impacts.push({
      mesh,
      material,
      phase: hash01(index, 13),
      rate: 0.42 + hash01(index, 14) * 0.42,
      size: 0.42 + hash01(index, 15) * 0.72,
      color,
    });
  }

  const rayCount = count * 3;
  const sprayPositions = new Float32Array(rayCount * 2 * 3);
  const sprayColors = new Float32Array(rayCount * 2 * 3);
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute("position", new THREE.BufferAttribute(sprayPositions, 3));
  sprayGeometry.setAttribute("color", new THREE.BufferAttribute(sprayColors, 3));
  sprayGeometry.name = "Procedural rain splash rays";
  geometries.push(sprayGeometry);
  for (let index = 0; index < impacts.length; index += 1) {
    for (let ray = 0; ray < 3; ray += 1) {
      const color = impacts[index].color;
      for (let vertex = 0; vertex < 2; vertex += 1) {
        const offset = ((index * 3 + ray) * 2 + vertex) * 3;
        sprayColors[offset] = color.r;
        sprayColors[offset + 1] = color.g;
        sprayColors[offset + 2] = color.b;
      }
    }
  }
  const sprayMaterial = new THREE.LineBasicNodeMaterial({
    name: "Procedural world-space puddle splashes",
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    depthTest: true,
    depthWrite: false,
    fog: true,
    toneMapped: true,
  });
  sprayMaterial.rtxReflectionMask = 0;
  sprayMaterial.userData.rtxIgnore = true;
  materials.push(sprayMaterial);
  const sprayLines = new THREE.LineSegments(sprayGeometry, sprayMaterial);
  sprayLines.name = "Procedural world puddle splash lines";
  sprayLines.renderOrder = 32;
  sprayLines.frustumCulled = false;
  sprayLines.userData.proceduralWeatherEffect = true;

  function update(time) {
    for (let index = 0; index < impacts.length; index += 1) {
      const impact = impacts[index];
      const cycle = (time * impact.rate + impact.phase) % 1;
      const active = cycle < 0.42;
      const progress = active ? cycle / 0.42 : 1;
      impact.mesh.visible = active;
      impact.mesh.scale.setScalar(impact.size * (0.12 + progress * 0.88));
      impact.material.opacity = active ? Math.pow(1 - progress, 1.5) * 0.34 : 0;
      for (let ray = 0; ray < 3; ray += 1) {
        const offset = (index * 3 + ray) * 6;
        if (!active || progress > 0.74) {
          sprayPositions.fill(-1000, offset, offset + 6);
          continue;
        }
        const angle = ray * Math.PI * 2 / 3 + hash01(index, 18) * Math.PI;
        const radius = impact.size * progress * (0.18 + ray * 0.045);
        const rise = Math.sin(progress / 0.74 * Math.PI) * impact.size * (0.18 + ray * 0.035);
        sprayPositions[offset] = impact.mesh.position.x;
        sprayPositions[offset + 1] = 0.065;
        sprayPositions[offset + 2] = impact.mesh.position.z;
        sprayPositions[offset + 3] = impact.mesh.position.x + Math.cos(angle) * radius;
        sprayPositions[offset + 4] = 0.065 + rise;
        sprayPositions[offset + 5] = impact.mesh.position.z + Math.sin(angle) * radius * 0.55;
      }
    }
    sprayGeometry.attributes.position.needsUpdate = true;
  }

  return { impacts, sprayLines, update };
}

export async function createDowntownWeather(scene, config) {
  // These files remain in the Grok provenance inventory, but none supplies
  // visible rain. Weather is constructed procedurally below in world space.
  const provenanceAssets = await Promise.all([
    loadMask("weather/rain-streak-tile.png"),
    loadMask("weather/window-rain-sheet.png"),
    loadCutout("weather/low-mist-bank.png"),
    loadCutout("weather/puddle-ripple-sheet.png", { crop: false }),
    loadCutout("weather/tire-spray.png"),
  ]);
  void provenanceAssets;

  const group = new THREE.Group();
  group.name = "Procedural RTX-integrated world weather";
  const materials = [];
  const geometries = [];
  const rain = makeRainStreaks(config, materials, geometries);
  const puddles = makePuddleImpacts(config, materials, geometries);
  group.add(rain.lines, puddles.sprayLines);
  for (const impact of puddles.impacts) group.add(impact.mesh);
  scene.add(group);
  let enabled = true;

  return {
    group,
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      enabled = Boolean(value);
      group.visible = enabled;
    },
    update(time) {
      if (!enabled) return;
      rain.update(Number(time) || 0);
      puddles.update(Number(time) || 0);
    },
    dispose() {
      scene.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
