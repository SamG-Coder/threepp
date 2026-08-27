import * as THREE from "three/webgpu";
import { keyedCanvasFromImage } from "./chroma-key.mjs";
import { terrainHeight, WORLD } from "./path.mjs";

/**
 * Photoreal 2.5D ridge cards behind the playable bank. Camera looks +Z;
 * these sit at far Z so they fill the horizon without faceted heightfields.
 */
const CARDS = Object.freeze([
  Object.freeze({
    name: "Mid eucalyptus wall",
    file: "mid-ridge.jpg",
    z: 74,
    height: 22,
    copies: 5,
    yLift: -0.55,
  }),
  Object.freeze({
    name: "Far sandstone ridge",
    file: "far-ridge.jpg",
    z: 118,
    height: 40,
    copies: 4,
    yLift: -1.4,
  }),
]);

async function loadImage(url) {
  const href = url.href || String(url);
  if (typeof fetch === "function" && typeof createImageBitmap === "function") {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Failed to load ${href} (${response.status})`);
    return createImageBitmap(await response.blob());
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${href}`));
    image.src = href;
  });
}

export async function createHills() {
  const group = new THREE.Group();
  group.name = "Hawkesbury wooded ridges";
  const materials = [];
  const geometries = [];
  const maps = [];

  for (const card of CARDS) {
    const url = new URL(`../assets/hills/${card.file}`, import.meta.url);
    let image;
    try {
      image = await loadImage(url);
    } catch (error) {
      console.warn(`[Secret River] skipped ridge ${card.file}: ${error?.message || error}`);
      continue;
    }
    const keyed = keyedCanvasFromImage(image, { padding: 2 });
    const map = new THREE.CanvasTexture(keyed.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
    map.name = card.file;
    maps.push(map);
    const width = card.height * keyed.aspect;
    const geometry = new THREE.PlaneGeometry(width, card.height);
    geometry.name = `${card.name} card`;
    geometries.push(geometry);
    const material = new THREE.MeshBasicNodeMaterial({
      name: card.name,
      map,
      transparent: true,
      alphaTest: 0.28,
      fog: true,
      depthWrite: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    material.userData.rtxIgnore = true;
    materials.push(material);
    const span = WORLD.maxX - WORLD.minX + width * 0.35;
    const start = WORLD.minX - width * 0.2;
    for (let index = 0; index < card.copies; index++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${card.name} ${index}`;
      const x = start + (index + 0.5) * (span / card.copies);
      const ground = terrainHeight(
        THREE.MathUtils.clamp(x, WORLD.minX, WORLD.maxX),
        Math.min(WORLD.maxZ - 1, card.z),
      );
      mesh.position.set(
        x,
        ground + card.height * 0.5 + card.yLift,
        card.z + (index % 2) * 3.1,
      );
      mesh.rotation.y = Math.PI;
      mesh.scale.x = index % 2 === 0 ? 1 : -1;
      mesh.frustumCulled = false;
      mesh.userData.rtxIgnore = true;
      mesh.renderOrder = card.z < 100 ? -3 : -5;
      group.add(mesh);
    }
    if (typeof image.close === "function") image.close();
  }

  return {
    group,
    rtxRoots: [],
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const map of maps) map.dispose();
    },
  };
}
