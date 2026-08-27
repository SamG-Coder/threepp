import * as THREE from "three/webgpu";
import { keyedCanvasFromImage } from "./chroma-key.mjs";
import { layoutFlora, FLORA_KINDS } from "./flora-layout.mjs";
import { applyCardWind, setWindTime } from "./wind.mjs";

export { layoutFlora, FLORA_KINDS };

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

async function loadKindTexture(kind) {
  const url = new URL(`../assets/flora/${kind.file}`, import.meta.url);
  const image = await loadImage(url);
  const keyed = keyedCanvasFromImage(image, { padding: 3 });
  const texture = new THREE.CanvasTexture(keyed.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.name = `${kind.id} cutout`;
  if (typeof image.close === "function") image.close();
  return { texture, aspect: keyed.aspect, width: keyed.width, height: keyed.height };
}

export async function createFlora(seed = 0x51c7e1) {
  const records = layoutFlora(seed);
  const assets = new Map();
  for (const kind of FLORA_KINDS) {
    try {
      assets.set(kind.id, await loadKindTexture(kind));
    } catch {
      continue;
    }
  }

  const group = new THREE.Group();
  group.name = "Face-on bank flora";
  const proxyGroup = new THREE.Group();
  proxyGroup.name = "RTX flora grounding proxies";
  const visualMaterials = [];
  const proxyMaterials = [];
  const dummy = new THREE.Object3D();

  const byKind = new Map();
  for (const record of records) {
    const list = byKind.get(record.kind) ?? [];
    list.push(record);
    byKind.set(record.kind, list);
  }

  for (const kind of FLORA_KINDS) {
    const placed = byKind.get(kind.id);
    const asset = assets.get(kind.id);
    if (!placed?.length || !asset) continue;
    const height = kind.height;
    const width = height * asset.aspect;
    const visualGeometry = new THREE.PlaneGeometry(1, 1);
    visualGeometry.name = `${kind.id} card`;
    const visualMaterial = new THREE.MeshBasicNodeMaterial({
      name: `${kind.id} photoreal card`,
      map: asset.texture,
      transparent: true,
      alphaTest: 0.18,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: true,
    });
    visualMaterial.userData.rtxIgnore = true;
    const sway = kind.id === "reeds" || kind.id === "grass" || kind.id === "lomandra"
      ? 0.07
      : kind.id === "wattle" || kind.id === "fern"
        ? 0.03
        : 0;
    if (sway > 0) applyCardWind(visualMaterial, sway);
    visualMaterials.push(visualMaterial);
    const visual = new THREE.InstancedMesh(visualGeometry, visualMaterial, placed.length);
    visual.name = `${kind.id} billboards`;
    visual.frustumCulled = false;
    visual.castShadow = true;
    visual.receiveShadow = false;
    visual.userData.rtxIgnore = true;

    placed.forEach((record, index) => {
      dummy.position.set(record.x, record.y + record.height * 0.5, record.z);
      dummy.rotation.set(0, Math.PI, 0);
      dummy.scale.set(width * record.scale * record.flip, record.height, 1);
      dummy.updateMatrix();
      visual.setMatrixAt(index, dummy.matrix);
      const tone = 0.92 + ((index * 29 + Math.round(record.x * 7)) & 15) / 145;
      visual.setColorAt(index, new THREE.Color(tone * 1.02, tone, tone * 0.94));
    });
    visual.instanceMatrix.needsUpdate = true;
    if (visual.instanceColor) visual.instanceColor.needsUpdate = true;
    group.add(visual);

    if (!new Set(["wattle", "sapling", "log", "fern", "lomandra"]).has(kind.id)) continue;
    const proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
    proxyGeometry.name = `${kind.id} RTX proxy`;
    const proxyMaterial = new THREE.MeshStandardNodeMaterial({
      name: `${kind.id} RTX grounding volume`,
      color: kind.id === "log" ? 0x4a3420 : 0x35452b,
      roughness: 0.88,
      metalness: 0,
    });
    proxyMaterials.push(proxyMaterial);
    const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, placed.length);
    proxy.name = `${kind.id} RTX volumes`;
    proxy.frustumCulled = false;
    proxy.castShadow = true;
    placed.forEach((record, index) => {
      const isLog = kind.id === "log";
      dummy.position.set(
        record.x,
        record.y + record.height * (isLog ? 0.28 : 0.42),
        record.z + 0.06,
      );
      dummy.rotation.set(0, Math.PI, 0);
      dummy.scale.set(
        width * record.scale * (isLog ? 0.88 : 0.34),
        record.height * (isLog ? 0.54 : 0.74),
        isLog ? 0.38 : Math.max(0.22, width * record.scale * 0.12),
      );
      dummy.updateMatrix();
      proxy.setMatrixAt(index, dummy.matrix);
    });
    proxy.instanceMatrix.needsUpdate = true;
    proxyGroup.add(proxy);
  }

  group.add(proxyGroup);

  const tintColor = new THREE.Color(0xffffff);

  return {
    group,
    proxyGroup,
    rtxRoots: [proxyGroup],
    records,
    update(elapsed) {
      setWindTime(elapsed);
    },
    setTint(value = 0xffffff) {
      if (value && typeof value === "object" && Number.isFinite(value.r)) tintColor.copy(value);
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
