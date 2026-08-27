import * as THREE from "three/webgpu";
import {
  bumpMap,
  dot,
  float,
  mix,
  positionWorld,
  reflector,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { loadMask, loadSurface } from "./assets.mjs";

const rainClock = uniform(0);
const rainIntensity = uniform(1);

function flatGeometry(width, depth) {
  const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
  geometry.rotateX(-Math.PI * 0.5);
  return geometry;
}

function makeSurfaceMesh(geometry, material, name, y, z, renderOrder = -1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(0, y, z);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.userData.flatImageSurface = true;
  return mesh;
}

export async function createDowntownSurfaces(scene, config) {
  const width = config.world.maxX - config.world.minX;
  const centerX = (config.world.maxX + config.world.minX) * 0.5;
  const roadMin = config.world.roadZ[0];
  const roadMax = config.world.roadZ[1];
  const roadDepth = roadMax - roadMin;
  const roadCenter = (roadMax + roadMin) * 0.5;
  const farMin = config.world.farSidewalkZ[0];
  const farMax = config.world.farSidewalkZ[1];
  const nearMin = config.world.nearSidewalkZ[0];
  const nearMax = config.world.nearSidewalkZ[1];

  const [
    asphaltAsset,
    sidewalkAsset,
    alleyAsset,
    crosswalkAsset,
    wetnessAsset,
    roofAsset,
    curbAsset,
    whiteAsset,
    yellowAsset,
    drainAsset,
  ] = await Promise.all([
    loadSurface("surfaces/asphalt-neutral.png"),
    loadSurface("surfaces/sidewalk-tile-neutral.png"),
    loadSurface("surfaces/alley-concrete-neutral.png"),
    loadSurface("surfaces/crosswalk-paint-neutral.png"),
    loadMask("surfaces/wetness-breakup-mask.png"),
    loadSurface("surfaces/roof-gravel-neutral.png"),
    loadSurface("surfaces/curb-neutral.png"),
    loadSurface("surfaces/lane-white-neutral.png"),
    loadSurface("surfaces/lane-yellow-neutral.png"),
    loadSurface("surfaces/drain-grate-neutral.png"),
  ]);

  asphaltAsset.texture.repeat.set(width / 8, roadDepth / 8);
  sidewalkAsset.texture.repeat.set(width / 5.5, 1.3);
  alleyAsset.texture.repeat.set(2, 5);
  wetnessAsset.texture.repeat.set(width / 15, roadDepth / 12);
  roofAsset.texture.repeat.set(3, 1.4);
  curbAsset.texture.repeat.set(width / 4, 1);
  whiteAsset.texture.repeat.set(width / 4, 1);
  yellowAsset.texture.repeat.set(width / 4, 1);
  drainAsset.texture.repeat.set(1, 1);

  const group = new THREE.Group();
  group.name = "Flat Grok road and pavement surfaces";
  group.position.x = centerX;
  const proxyGroup = new THREE.Group();
  proxyGroup.name = "Flat native ground registration planes";
  proxyGroup.position.x = centerX;
  const geometries = [];
  const materials = [];
  const materialSwaps = [];

  const roadGeometry = flatGeometry(width, roadDepth);
  geometries.push(roadGeometry);
  const reflection = reflector({
    resolutionScale: 0.68,
    generateMipmaps: true,
    bounces: false,
    samples: 1,
  });
  const asphalt = texture(asphaltAsset.texture).rgb;
  const wetnessSample = texture(wetnessAsset.texture).rgb;
  const wetnessLuma = dot(wetnessSample, vec3(0.2126, 0.7152, 0.0722));
  const wetness = smoothstep(float(0.24), float(0.76), wetnessLuma);
  const rippleA = sin(
    positionWorld.x.mul(1.73)
      .add(positionWorld.z.mul(2.19))
      .sub(rainClock.mul(3.8)),
  ).mul(0.0035).mul(wetness).mul(rainIntensity);
  const rippleB = sin(
    positionWorld.x.mul(3.31)
      .sub(positionWorld.z.mul(1.27))
      .sub(rainClock.mul(5.2)),
  ).mul(0.0018).mul(wetness).mul(rainIntensity);
  const rainNormal = bumpMap(rippleA.add(rippleB), 0.22);
  reflection.uvNode = reflection.uvNode.add(vec2(rippleA, rippleB));
  reflection.levelNode = mix(float(2.1), float(0.42), wetness);

  function rainMaterialPair(map, options = {}) {
    const base = texture(map).rgb;
    const dryBrightness = Number(options.dryBrightness ?? 0.9);
    const wetBrightness = Number(options.wetBrightness ?? 0.62);
    const dryRoughness = Number(options.dryRoughness ?? 0.76);
    const wetRoughness = Number(options.wetRoughness ?? 0.22);
    const dryClearcoat = Number(options.dryClearcoat ?? 0.03);
    const wetClearcoat = Number(options.wetClearcoat ?? 0.56);
    const dryCoatRoughness = Number(options.dryCoatRoughness ?? 0.46);
    const wetCoatRoughness = Number(options.wetCoatRoughness ?? 0.13);
    const rtxReflectionMask = Number(options.rtxReflectionMask ?? 0.2);

    const create = native => {
      const material = new THREE.MeshPhysicalNodeMaterial({
        name: `${options.name || "Grok flat surface"}${native ? " native guide" : " planar rain"}`,
        roughness: dryRoughness,
        metalness: Number(options.metalness ?? 0.01),
        clearcoat: wetClearcoat,
        clearcoatRoughness: wetCoatRoughness,
        side: THREE.DoubleSide,
      });
      material.colorNode = base.mul(mix(float(dryBrightness), float(wetBrightness), wetness));
      material.normalNode = rainNormal;
      material.roughnessNode = mix(float(dryRoughness), float(wetRoughness), wetness);
      material.clearcoatNode = mix(float(dryClearcoat), float(wetClearcoat), wetness);
      material.clearcoatRoughnessNode = mix(
        float(dryCoatRoughness),
        float(wetCoatRoughness),
        wetness,
      );
      if (native) {
        material.rtxReflectionMask = rtxReflectionMask;
      } else {
        material.rtxReflectionMask = 0;
      }
      material.userData.rtxIgnore = true;
      if (options.polygonOffset) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -2;
      }
      materials.push(material);
      return material;
    };

    return { planar: create(false), native: create(true) };
  }

  function trackMaterialSwap(mesh, pair) {
    materialSwaps.push({ mesh, planar: pair.planar, native: pair.native });
    return mesh;
  }

  const roadMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Grok wet asphalt with real card reflection",
    roughness: 0.54,
    metalness: 0.01,
    clearcoat: 0.48,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });
  roadMaterial.colorNode = asphalt.mul(mix(float(0.70), float(0.48), wetness));
  roadMaterial.normalNode = rainNormal;
  roadMaterial.roughnessNode = mix(float(0.76), float(0.17), wetness);
  roadMaterial.clearcoatNode = mix(float(0.12), float(0.68), wetness);
  roadMaterial.clearcoatRoughnessNode = mix(float(0.38), float(0.12), wetness);
  roadMaterial.emissiveNode = reflection.rgb.mul(wetness).mul(0.58);
  roadMaterial.rtxReflectionMask = 0;
  roadMaterial.userData.rtxIgnore = true;
  const nativeRoadMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Grok wet asphalt native reflection guide",
    roughness: 0.54,
    metalness: 0.01,
    clearcoat: 0.48,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });
  nativeRoadMaterial.colorNode = asphalt.mul(mix(float(0.70), float(0.48), wetness));
  nativeRoadMaterial.normalNode = rainNormal;
  nativeRoadMaterial.roughnessNode = mix(float(0.76), float(0.17), wetness);
  nativeRoadMaterial.clearcoatNode = mix(float(0.12), float(0.68), wetness);
  nativeRoadMaterial.clearcoatRoughnessNode = mix(float(0.38), float(0.12), wetness);
  nativeRoadMaterial.rtxReflectionMask = 0.58;
  nativeRoadMaterial.userData.rtxIgnore = true;
  materials.push(roadMaterial, nativeRoadMaterial);
  const road = makeSurfaceMesh(roadGeometry, roadMaterial, "Wet reflected avenue", 0, roadCenter, -3);
  road.position.x = 0;
  materialSwaps.push({ mesh: road, planar: roadMaterial, native: nativeRoadMaterial });
  reflection.target.name = "Wet avenue planar reflector";
  reflection.target.rotation.x = -Math.PI * 0.5;
  road.add(reflection.target);
  group.add(road);

  const farGeometry = flatGeometry(width, farMax - farMin);
  const nearGeometry = flatGeometry(width, nearMax - nearMin);
  geometries.push(farGeometry, nearGeometry);
  const sidewalkMaterial = rainMaterialPair(sidewalkAsset.texture, {
    name: "Grok sidewalk",
    dryBrightness: 0.9,
    wetBrightness: 0.6,
    dryRoughness: 0.76,
    wetRoughness: 0.25,
    wetClearcoat: 0.54,
    rtxReflectionMask: 0.22,
  });
  const farSidewalk = makeSurfaceMesh(
    farGeometry,
    sidewalkMaterial.planar,
    "Playable far sidewalk",
    0.12,
    (farMin + farMax) * 0.5,
    -2,
  );
  const nearSidewalk = makeSurfaceMesh(
    nearGeometry,
    sidewalkMaterial.planar,
    "Foreground sidewalk",
    0.09,
    (nearMin + nearMax) * 0.5,
    30,
  );
  trackMaterialSwap(farSidewalk, sidewalkMaterial);
  trackMaterialSwap(nearSidewalk, sidewalkMaterial);
  group.add(farSidewalk, nearSidewalk);

  const detailMaterial = (asset, name, options = {}) => rainMaterialPair(asset.texture, {
    name,
    polygonOffset: true,
    dryBrightness: 0.92,
    wetBrightness: 0.68,
    dryRoughness: 0.66,
    wetRoughness: 0.27,
    wetClearcoat: 0.5,
    rtxReflectionMask: 0.18,
    ...options,
  });
  const crosswalkMaterial = detailMaterial(crosswalkAsset, "Grok crosswalk paint");
  {
    const gravelMaterial = detailMaterial(roofAsset, "Grok gravel maintenance patch", {
      dryRoughness: 0.93,
      wetRoughness: 0.54,
      wetClearcoat: 0.25,
      rtxReflectionMask: 0.07,
    });
    const geometry = flatGeometry(10.5, 3.0);
    geometries.push(geometry);
    const patch = makeSurfaceMesh(
      geometry,
      gravelMaterial.planar,
      "Flat gravel roadwork patch",
      0.132,
      8.6,
      1,
    );
    patch.position.x = 82 - centerX;
    trackMaterialSwap(patch, gravelMaterial);
    group.add(patch);
  }
  for (const x of [-32, 52]) {
    const geometry = flatGeometry(7.4, roadDepth - 0.35);
    geometries.push(geometry);
    const mesh = makeSurfaceMesh(
      geometry,
      crosswalkMaterial.planar,
      "Rainy crosswalk",
      0.025,
      roadCenter,
      2,
    );
    mesh.position.x = x - centerX;
    trackMaterialSwap(mesh, crosswalkMaterial);
    group.add(mesh);
  }

  const whiteMaterial = detailMaterial(whiteAsset, "Grok white lane marking", {
    dryRoughness: 0.6,
    wetRoughness: 0.2,
    rtxReflectionMask: 0.22,
  });
  const yellowMaterial = detailMaterial(yellowAsset, "Grok amber lane marking", {
    dryRoughness: 0.6,
    wetRoughness: 0.2,
    rtxReflectionMask: 0.22,
  });
  for (const z of [roadMin + 1.15, roadMax - 1.15]) {
    const geometry = flatGeometry(width, 0.18);
    geometries.push(geometry);
    const line = makeSurfaceMesh(geometry, whiteMaterial.planar, "White lane edge", 0.032, z, 3);
    trackMaterialSwap(line, whiteMaterial);
    group.add(line);
  }
  {
    const geometry = flatGeometry(width, 0.24);
    geometries.push(geometry);
    const line = makeSurfaceMesh(
      geometry,
      yellowMaterial.planar,
      "Center road line",
      0.034,
      roadCenter,
      3,
    );
    trackMaterialSwap(line, yellowMaterial);
    group.add(line);
  }

  const curbMaterial = detailMaterial(curbAsset, "Grok wet curb strip", {
    dryRoughness: 0.67,
    wetRoughness: 0.2,
    rtxReflectionMask: 0.24,
  });
  {
    const geometry = flatGeometry(width, 0.44);
    geometries.push(geometry);
    const curb = makeSurfaceMesh(
      geometry,
      curbMaterial.planar,
      "Far wet curb",
      0.105,
      roadMax - 0.18,
      4,
    );
    trackMaterialSwap(curb, curbMaterial);
    group.add(curb);
  }

  const alleyMaterial = rainMaterialPair(alleyAsset.texture, {
    name: "Grok alley ground",
    dryBrightness: 0.85,
    wetBrightness: 0.54,
    dryRoughness: 0.8,
    wetRoughness: 0.24,
    wetClearcoat: 0.58,
    rtxReflectionMask: 0.24,
  });
  for (const x of [-32, 52]) {
    const geometry = flatGeometry(8, 22);
    geometries.push(geometry);
    const alley = makeSurfaceMesh(
      geometry,
      alleyMaterial.planar,
      "Layered service alley floor",
      0.115,
      22,
      -5,
    );
    alley.position.x = x - centerX;
    trackMaterialSwap(alley, alleyMaterial);
    group.add(alley);
  }

  const drainMaterial = detailMaterial(drainAsset, "Grok drain grate", {
    dryBrightness: 0.82,
    wetBrightness: 0.5,
    dryRoughness: 0.52,
    wetRoughness: 0.14,
    wetClearcoat: 0.68,
    rtxReflectionMask: 0.34,
    metalness: 0.24,
  });
  for (let x = config.world.minX + 8; x < config.world.maxX; x += 18) {
    const geometry = flatGeometry(1.15, 0.38);
    geometries.push(geometry);
    const drain = makeSurfaceMesh(
      geometry,
      drainMaterial.planar,
      "Curb drain",
      0.128,
      roadMax + 0.16,
      5,
    );
    drain.position.x = x - centerX;
    trackMaterialSwap(drain, drainMaterial);
    group.add(drain);
  }

  const proxyMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Flat native road proxy",
    color: 0x111820,
    roughness: 0.46,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  proxyMaterial.userData.rtxTriangleRadiance = [0.02, 0.035, 0.055, 1];
  proxyMaterial.rtxReflectionMask = 0.5;
  materials.push(proxyMaterial);
  const roadProxy = makeSurfaceMesh(roadGeometry, proxyMaterial, "Flat ray road", -0.015, roadCenter, -100);
  proxyGroup.add(roadProxy);

  scene.add(group, proxyGroup);

  return {
    group,
    proxyGroup,
    road,
    reflection,
    setNativeMode(enabled) {
      const native = Boolean(enabled);
      for (const swap of materialSwaps) {
        swap.mesh.material = native ? swap.native : swap.planar;
      }
      reflection.reflector.updateBeforeType = native
        ? THREE.NodeUpdateType.NONE
        : THREE.NodeUpdateType.FRAME;
      if (!native) reflection.reflector.forceUpdate = true;
    },
    setRainEnabled(enabled) {
      // The road remains wet after the shower, but active impact ripples stop.
      rainIntensity.value = enabled ? 1 : 0;
    },
    update(time) {
      rainClock.value = Number(time) || 0;
    },
    hideProxies() {
      proxyGroup.visible = false;
    },
    dispose() {
      scene.remove(group, proxyGroup);
      reflection.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
