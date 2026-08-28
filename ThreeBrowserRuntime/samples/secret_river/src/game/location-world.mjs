import * as THREE from "three/webgpu";
import { createFlora } from "../flora.mjs";
import { createHills } from "../hills.mjs";
import { roadCenterZ, terrainHeight } from "../path.mjs";
import { createRiver } from "../river.mjs";
import { createTerrain } from "../terrain.mjs";
import { createTreeFlats } from "../trees.mjs";

function makeMarkerCanvas(label, completed = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);

  context.shadowColor = "rgba(0,0,0,0.34)";
  context.shadowBlur = 18;
  context.fillStyle = completed ? "rgba(145,164,123,0.78)" : "rgba(236,202,111,0.94)";
  context.beginPath();
  context.arc(128, 95, completed ? 34 : 42, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = completed ? "rgba(229,236,210,0.7)" : "rgba(52,39,21,0.82)";
  context.lineWidth = 6;
  context.stroke();

  context.strokeStyle = completed ? "rgba(210,224,194,0.62)" : "rgba(238,207,126,0.72)";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(128, 138);
  context.lineTo(128, 250);
  context.stroke();

  context.fillStyle = "rgba(14,23,19,0.78)";
  context.beginPath();
  context.roundRect(18, 244, 220, 56, 13);
  context.fill();
  context.fillStyle = completed ? "#d9e1c9" : "#f1dfad";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 18px Segoe UI, sans-serif";
  const words = String(label || "Observe").toUpperCase().split(/\s+/);
  const line = words.length > 3 ? `${words.slice(0, 3).join(" ")}…` : words.join(" ");
  context.fillText(line, 128, 272, 202);
  return canvas;
}

function createMarkerRecord(objective) {
  const canvas = makeMarkerCanvas(objective.title, false);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `${objective.id} painted waypoint`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const geometry = new THREE.PlaneGeometry(1.9, 2.38);
  const material = new THREE.MeshBasicNodeMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  material.userData.rtxIgnore = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${objective.title} 2.5D waypoint`;
  mesh.rotation.y = Math.PI;
  mesh.position.set(
    objective.completion.position.x,
    terrainHeight(objective.completion.position.x, objective.completion.position.z) + 1.12,
    objective.completion.position.z + 0.3,
  );
  mesh.renderOrder = 5;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.rtxIgnore = true;
  return {
    objective,
    mesh,
    material,
    texture,
    geometry,
    baseY: mesh.position.y,
    completed: false,
    setCompleted(completed) {
      if (this.completed === completed) return;
      this.completed = completed;
      const nextCanvas = makeMarkerCanvas(objective.title, completed);
      texture.image = nextCanvas;
      texture.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

function createLocationMarkers(location) {
  const group = new THREE.Group();
  group.name = `${location.name} painted waypoints`;
  group.userData.rtxIgnore = true;
  const records = location.objectives.map(createMarkerRecord);
  for (const record of records) group.add(record.mesh);
  return {
    group,
    records,
    setCompleted(completedIds) {
      const completed = new Set(completedIds);
      for (const record of records) record.setCompleted(completed.has(record.objective.id));
    },
    update(elapsed) {
      records.forEach((record, index) => {
        record.mesh.position.y = record.baseY + Math.sin(elapsed * 1.35 + index * 1.7) * 0.09;
        const pulse = record.completed ? 0.82 : 0.96 + Math.sin(elapsed * 2.1 + index) * 0.04;
        record.mesh.scale.setScalar(pulse);
      });
    },
    dispose() {
      for (const record of records) record.dispose();
      group.clear();
    },
  };
}

function exaggerateFirstBranchRidges(hills, location) {
  if (!location.id.includes("first-branch")) return;
  for (const card of hills.group.children) {
    card.scale.y *= 1.32;
    card.position.y += 3.1;
  }
  hills.group.name = "First Branch steep sandstone and forest ridges";
}

export async function createLocationWorld(location) {
  const root = new THREE.Group();
  root.name = `${location.name} map-derived world`;

  const terrain = await createTerrain();
  const river = createRiver();
  const hills = await createHills();
  exaggerateFirstBranchRidges(hills, location);
  const trees = await createTreeFlats(location.dressingSeeds.trees);
  const flora = await createFlora(location.dressingSeeds.flora);
  const markers = createLocationMarkers(location);

  root.add(
    terrain.group,
    river.mesh,
    hills.group,
    trees.group,
    flora.group,
    markers.group,
  );

  return {
    root,
    location,
    terrain,
    river,
    hills,
    trees,
    flora,
    markers,
    rtxRoots: [
      ...terrain.rtxRoots,
      ...(hills.rtxRoots ?? []),
      ...trees.rtxRoots,
      ...(flora.rtxRoots ?? []),
    ],
    roadZAt(x) {
      return roadCenterZ(x);
    },
    setTint(color) {
      trees.setTint?.(color);
      flora.setTint?.(color);
    },
    setCompleted(completedIds) {
      markers.setCompleted(completedIds);
    },
    update(elapsed) {
      river.update(elapsed);
      flora.update?.(elapsed);
      trees.update?.(elapsed);
      markers.update(elapsed);
    },
    hideProxies() {
      trees.hideProxies();
      flora.hideProxies?.();
    },
    dispose() {
      root.removeFromParent();
      terrain.dispose();
      river.dispose();
      hills.dispose();
      trees.dispose();
      flora.dispose();
      markers.dispose();
      root.clear();
    },
  };
}
