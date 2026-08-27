import * as THREE from "three/webgpu";
import { keyedCanvasFromImage } from "./chroma-key.mjs";
import { layoutTrees, TREE_SPECIES } from "./tree-layout.mjs";
import { applyFoliageWind } from "./wind.mjs";

export { layoutTrees, TREE_SPECIES };

const LAYER_ORDER = Object.freeze({
  far: -2,
  mid: -1,
  play: 0,
  foreground: 2,
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

export async function createTreeFlats(seed = 0x51c7e1) {
  const records = layoutTrees(seed);
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
    const placed = bySpecies.get(species.id);
    const asset = assets.get(species.id);
    if (!placed?.length || !asset) continue;
    const height = species.height;
    const width = height * asset.aspect;
    const visualGeometry = new THREE.PlaneGeometry(1, 1, 10, 18);
    visualGeometry.name = `${species.id} card`;
    const visualMaterial = new THREE.MeshBasicNodeMaterial({
      name: `${species.id} photoreal card`,
      map: asset.texture,
      transparent: true,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: false,
      toneMapped: false,
    });
    visualMaterial.userData.rtxIgnore = true;
    applyFoliageWind(visualMaterial, asset.texture, species.height > 8 ? 0.055 : 0.07);
    visualMaterials.push(visualMaterial);
    const visual = new THREE.InstancedMesh(visualGeometry, visualMaterial, placed.length);
    visual.name = `${species.id} billboards`;
    visual.frustumCulled = false;
    visual.castShadow = true;
    visual.receiveShadow = false;
    visual.userData.rtxIgnore = true;
    visual.renderOrder = LAYER_ORDER[placed[0]?.layer] ?? 0;

    const proxyGeometry = new THREE.PlaneGeometry(0.55, 0.84);
    proxyGeometry.name = `${species.id} shadow proxy`;
    const proxyMaterial = new THREE.MeshStandardNodeMaterial({
      name: `${species.id} RTX proxy`,
      color: new THREE.Color().fromArray(species.albedo),
      roughness: 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    proxyMaterials.push(proxyMaterial);
    const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, placed.length);
    proxy.name = `${species.id} RTX cards`;
    proxy.frustumCulled = false;
    proxy.castShadow = true;

    placed.forEach((record, index) => {
      dummy.position.set(record.x, record.y + record.height * 0.5, record.z);
      dummy.rotation.set(0, Math.PI, 0);
      dummy.scale.set(width * record.scale * record.flip, record.height, 1);
      dummy.updateMatrix();
      visual.setMatrixAt(index, dummy.matrix);
      dummy.scale.set(width * record.scale * record.flip * 0.55, record.height * 0.84, 1);
      dummy.updateMatrix();
      proxy.setMatrixAt(index, dummy.matrix);
    });
    visual.instanceMatrix.needsUpdate = true;
    proxy.instanceMatrix.needsUpdate = true;
    group.add(visual);
    proxyGroup.add(proxy);
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
      for (const material of visualMaterials) material.color.copy(tintColor);
    },
    hideProxies() {
      proxyGroup.visible = false;
    },
    dispose() {
      group.traverse(object => {
        object.geometry?.dispose?.();
      });
      for (const material of visualMaterials) {
        material.map?.dispose?.();
        material.dispose();
      }
      for (const material of proxyMaterials) material.dispose();
    },
  };
}
