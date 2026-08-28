import * as THREE from "three/webgpu";
import { keyedCanvasFromImage } from "./chroma-key.mjs";
import {
  DEFAULT_LAYOUT_SEED,
  layoutTrees,
  TREE_SPECIES,
} from "./tree-layout.mjs";
import { applyFoliageWind } from "./wind.mjs";

export { layoutTrees, TREE_SPECIES };

const LAYER_ORDER = Object.freeze({
  far: -2,
  mid: -1,
  play: 0,
  foreground: 2,
});

const LAYER_TINT = Object.freeze({
  foreground: new THREE.Color(1.03, 0.99, 0.91),
  play: new THREE.Color(1.0, 1.0, 0.98),
  mid: new THREE.Color(0.94, 0.98, 1.0),
  far: new THREE.Color(0.84, 0.91, 1.0),
});

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

async function loadSpeciesTexture(species) {
  const url = new URL(`../assets/trees/${species.file}`, import.meta.url);
  const image = await loadImage(url);
  const keyed = keyedCanvasFromImage(image, { padding: 3 });
  const texture = new THREE.CanvasTexture(keyed.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.name = `${species.id} cutout`;
  if (typeof image.close === "function") image.close();
  return { texture, aspect: keyed.aspect, width: keyed.width, height: keyed.height };
}

/**
 * Resolve card placements without changing the authored demo default.
 *
 * Game locations can inject map-conditioned records as the second argument,
 * or use the options form `{ seed, records }`. The original zero/one-argument
 * calls still run `layoutTrees(seed)` exactly as before.
 */
export function treeRecordsFor(seed = DEFAULT_LAYOUT_SEED, recordsOverride = null) {
  if (Array.isArray(seed)) return seed;
  if (seed && typeof seed === "object") {
    if (Array.isArray(seed.records)) return seed.records;
    return layoutTrees(seed.seed ?? DEFAULT_LAYOUT_SEED);
  }
  if (Array.isArray(recordsOverride)) return recordsOverride;
  return layoutTrees(seed);
}

export async function createTreeFlats(seed = DEFAULT_LAYOUT_SEED, recordsOverride = null) {
  const records = treeRecordsFor(seed, recordsOverride);
  const assets = new Map();
  for (const species of TREE_SPECIES) {
    try {
      assets.set(species.id, await loadSpeciesTexture(species));
    } catch (error) {
      console.warn(`[Secret River] skipped tree ${species.id}: ${error?.message || error}`);
    }
  }

  const group = new THREE.Group();
  group.name = "Face-on Australian trees";
  const proxyGroup = new THREE.Group();
  proxyGroup.name = "RTX tree proxies";
  const visualMaterials = [];
  const proxyMaterials = [];
  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color(0xffffff);

  const bySpecies = new Map();
  for (const record of records) {
    const list = bySpecies.get(record.species) ?? [];
    list.push(record);
    bySpecies.set(record.species, list);
  }

  for (const species of TREE_SPECIES) {
    const speciesRecords = bySpecies.get(species.id);
    const asset = assets.get(species.id);
    if (!speciesRecords?.length || !asset) continue;
    const height = species.height;
    const width = height * asset.aspect;
    for (const layer of Object.keys(LAYER_ORDER)) {
      const placed = speciesRecords.filter(record => record.layer === layer);
      if (!placed.length) continue;
      const visualGeometry = new THREE.PlaneGeometry(1, 1, 10, 18);
      visualGeometry.name = `${species.id} ${layer} card`;
      const visualMaterial = new THREE.MeshBasicNodeMaterial({
        name: `${species.id} ${layer} painted card`,
        map: asset.texture,
        transparent: true,
        alphaTest: 0.18,
        side: THREE.DoubleSide,
        depthWrite: true,
        fog: true,
        toneMapped: true,
      });
      visualMaterial.userData.rtxIgnore = true;
      visualMaterial.userData.layerTint = LAYER_TINT[layer].clone();
      applyFoliageWind(visualMaterial, asset.texture, species.height > 8 ? 0.055 : 0.07);
      visualMaterials.push(visualMaterial);
      const visual = new THREE.InstancedMesh(visualGeometry, visualMaterial, placed.length);
      visual.name = `${species.id} ${layer} billboards`;
      visual.frustumCulled = false;
      visual.castShadow = true;
      visual.receiveShadow = false;
      visual.userData.rtxIgnore = true;
      visual.renderOrder = LAYER_ORDER[layer] ?? 0;

      // RTX sees a small trunk and crown volume rather than an opaque photo
      // rectangle. The resulting shadow remains soft and tree-like while the
      // planar photograph stays the visible authored surface.
      const trunkGeometry = new THREE.BoxGeometry(1, 1, 1);
      trunkGeometry.name = `${species.id} RTX trunks`;
      const crownGeometry = new THREE.SphereGeometry(0.5, 7, 5);
      crownGeometry.name = `${species.id} RTX crowns`;
      const proxyMaterial = new THREE.MeshStandardNodeMaterial({
        name: `${species.id} RTX organic proxy`,
        color: new THREE.Color().fromArray(species.albedo),
        roughness: 0.82,
        metalness: 0,
      });
      proxyMaterials.push(proxyMaterial);
      const trunks = new THREE.InstancedMesh(trunkGeometry, proxyMaterial, placed.length);
      const crowns = new THREE.InstancedMesh(crownGeometry, proxyMaterial, placed.length);
      trunks.name = `${species.id} RTX trunk volumes`;
      crowns.name = `${species.id} RTX crown volumes`;
      trunks.frustumCulled = false;
      crowns.frustumCulled = false;
      trunks.castShadow = true;
      crowns.castShadow = true;

      placed.forEach((record, index) => {
        const recordWidth = width * record.scale;
        dummy.position.set(record.x, record.y + record.height * 0.5, record.z);
        dummy.rotation.set(0, Math.PI, 0);
        dummy.scale.set(recordWidth * record.flip, record.height, 1);
        dummy.updateMatrix();
        visual.setMatrixAt(index, dummy.matrix);
        const tone = 0.93 + ((index * 37 + Math.round(record.x * 11)) & 15) / 150;
        visual.setColorAt(index, new THREE.Color(tone * 1.01, tone, tone * 0.96));

        const trunkHeight = record.height * 0.61;
        const trunkWidth = Math.max(0.18, recordWidth * 0.085);
        dummy.position.set(record.x, record.y + trunkHeight * 0.5, record.z + 0.08);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(trunkWidth, trunkHeight, trunkWidth * 0.72);
        dummy.updateMatrix();
        trunks.setMatrixAt(index, dummy.matrix);

        dummy.position.set(record.x, record.y + record.height * 0.70, record.z + 0.2);
        dummy.scale.set(recordWidth * 0.72, record.height * 0.48, Math.max(0.7, recordWidth * 0.24));
        dummy.updateMatrix();
        crowns.setMatrixAt(index, dummy.matrix);
      });
      visual.instanceMatrix.needsUpdate = true;
      if (visual.instanceColor) visual.instanceColor.needsUpdate = true;
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      group.add(visual);
      proxyGroup.add(trunks, crowns);
    }
  }

  group.add(proxyGroup);

  return {
    group,
    proxyGroup,
    rtxRoots: [proxyGroup],
    records,
    tint: tintColor,
    setTint(value = 0xffffff) {
      if (value && typeof value === "object" && Number.isFinite(value.r)) tintColor.copy(value);
      else if (Array.isArray(value)) tintColor.setRGB(value[0], value[1], value[2]);
      else tintColor.set(value);
      for (const material of visualMaterials) {
        material.color.copy(tintColor).multiply(material.userData.layerTint);
      }
    },
    hideProxies() {
      proxyGroup.visible = false;
    },
    dispose() {
      group.traverse(object => {
        object.geometry?.dispose?.();
      });
      for (const material of visualMaterials) material.dispose();
      for (const asset of assets.values()) asset.texture.dispose();
      for (const material of proxyMaterials) material.dispose();
    },
  };
}
