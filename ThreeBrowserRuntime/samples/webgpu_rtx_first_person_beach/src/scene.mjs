import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createBeachFoamField } from "./foam-field.mjs";
import {
  breakingInjectionNode,
  createBeachTerrainMaterial,
  createMappedMaterial,
  createMoonMaterial,
  createSkyMaterial,
  createWaterMaterial,
  foamVelocityNode,
  loadMoonMaps,
  skyNight,
  waterTime,
} from "./materials.mjs";
import { createMoonGlobe, createStarField } from "./sky-cycle.mjs";
import { prepareStudioPalm } from "./palm-model.mjs";
import { prepareStudioRockSet } from "./rock-model.mjs";
import {
  HEIGHT_BOUNDS,
  WATER_LEVEL,
  createHeightfieldGeometry,
  createTerrainHeightTexture,
  terrainHeight,
} from "./terrain.mjs";

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function createSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), createSkyMaterial());
  sky.name = "Tropical sky dome";
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.userData.rtxIgnore = true;
  scene.add(sky);
  return sky;
}

function createLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xc5def5, 0xb08958, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe1b0, 4.4);
  sun.name = "Late-afternoon sun";
  sun.position.set(-48, 54, 86);
  sun.target.position.set(0, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  const bounce = new THREE.DirectionalLight(0x87b7d8, 0.28);
  bounce.position.set(30, 18, -40);
  bounce.userData.rtxIgnore = true;
  scene.add(bounce);
  const moonLight = new THREE.DirectionalLight(0xc5d4ea, 0);
  moonLight.name = "Moon fill";
  moonLight.position.set(40, 36, -70);
  moonLight.target.position.set(0, 0, 4);
  moonLight.userData.rtxIgnore = true;
  scene.add(moonLight);
  scene.add(moonLight.target);
  return { hemi, sun, bounce, moonLight };
}

function createWater(scene, heightMap, foamField) {
  const geometry = new THREE.PlaneGeometry(320, 280, 180, 140);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.translate(0, 0, 78);
  const sample = foamField ? point => foamField.sampleNode(point) : null;
  const water = new THREE.Mesh(geometry, createWaterMaterial(heightMap, sample));
  water.name = "Displaced tropical water";
  water.position.y = WATER_LEVEL;
  water.renderOrder = 4;
  water.frustumCulled = false;
  water.userData.rtxIgnore = true;
  scene.add(water);
  return water;
}

function preRollFoam(foamField, seconds = 4.2) {
  const step = 1 / 30;
  const previous = waterTime.value;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    waterTime.value = previous + elapsed;
    foamField.update(step);
  }
  waterTime.value = previous + seconds;
}

async function loadPalmTemplate(maps) {
  const loader = new GLTFLoader();
  const url = new URL("../assets/models/realistic-beach-palm.glb", import.meta.url).href;
  const gltf = await loader.loadAsync(url);
  return prepareStudioPalm(gltf.scene, maps);
}

async function loadRockTemplates(maps) {
  const loader = new GLTFLoader();
  const url = new URL("../assets/models/coastal-rock-set.glb", import.meta.url).href;
  const gltf = await loader.loadAsync(url);
  return prepareStudioRockSet(gltf.scene, maps);
}

function addPalm(group, template, x, z, scale, yaw) {
  const ground = terrainHeight(x, z);
  const palm = template.clone(true);
  palm.name = "Coconut palm";
  palm.position.set(x, ground, z);
  palm.rotation.y = yaw;
  palm.scale.setScalar(scale);
  group.add(palm);
  return palm;
}

function addRock(group, templates, variant, x, z, scale, yaw, stretch) {
  const ground = terrainHeight(x, z);
  const template = templates[variant % templates.length];
  const rock = template.clone(false);
  rock.name = `Shore rock - ${template.name}`;
  const bounds = rock.geometry.boundingBox;
  const height = Math.max(0.01, bounds.max.y - bounds.min.y);
  const burial = height * scale * (template.userData.burialFraction ?? 0.38);
  rock.position.set(x, ground - burial, z);
  rock.scale.set(scale * stretch, scale, scale / stretch);
  const sampleRadius = 0.65;
  const slopeX = (terrainHeight(x + sampleRadius, z) - terrainHeight(x - sampleRadius, z)) / (sampleRadius * 2);
  const slopeZ = (terrainHeight(x, z + sampleRadius) - terrainHeight(x, z - sampleRadius)) / (sampleRadius * 2);
  const groundNormal = new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();
  rock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), groundNormal);
  rock.rotateOnWorldAxis(groundNormal, yaw);
  group.add(rock);
  return rock;
}

function addDriftwood(group, maps, x, z, length, yaw) {
  const ground = terrainHeight(x, z);
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.16, length, 7, 1),
    createMappedMaterial(maps["palm-bark"], {
      name: "driftwood",
      objectUv: true,
      roughness: 0.9,
      reflectionMask: 0.05,
    }),
  );
  log.name = "Driftwood";
  log.position.set(x, ground + 0.12, z);
  log.rotation.z = Math.PI * 0.5;
  log.rotation.y = yaw;
  log.castShadow = true;
  log.receiveShadow = true;
  group.add(log);
  return log;
}

export function createBeachEnvironment(renderer) {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x7fb3e6);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20, 16, 12),
    new THREE.MeshBasicNodeMaterial({ color: 0x6aa5dc, side: THREE.BackSide, fog: false }),
  );
  envScene.add(sky);
  const sunPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xffe2a8).multiplyScalar(6), fog: false }),
  );
  sunPanel.position.set(-6, 8, 12);
  sunPanel.lookAt(0, 0, 0);
  envScene.add(sunPanel);
  const sandPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshBasicNodeMaterial({ color: 0xc9a56a, fog: false }),
  );
  sandPanel.rotation.x = -Math.PI * 0.5;
  sandPanel.position.y = -4;
  envScene.add(sandPanel);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(envScene, 0.04, 0.2, 80, { size: 128 });
  generator.dispose();
  envScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

export async function buildBeachScene(scene, maps, renderer) {
  const sky = createSky(scene);
  const lights = createLighting(scene);
  const heightMap = createTerrainHeightTexture(THREE);
  const terrain = new THREE.Mesh(
    createHeightfieldGeometry(THREE, {
      columns: 300,
      rows: 260,
      uvScale: 0.24,
      minX: HEIGHT_BOUNDS.minX,
      maxX: HEIGHT_BOUNDS.maxX,
      minZ: HEIGHT_BOUNDS.minZ,
      maxZ: HEIGHT_BOUNDS.maxZ,
    }),
    createBeachTerrainMaterial(maps, heightMap),
  );
  terrain.name = "Beach heightfield";
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  const foamField = createBeachFoamField(renderer, {
    injectionNode: point => breakingInjectionNode(point, heightMap),
    velocityNode: foamVelocityNode,
    size: 512,
    worldSize: 320,
    originX: 0,
    originZ: 78,
    stepHz: 30,
    decaySeconds: 6.4,
    spread: 1.25,
  });
  foamField.clear();
  preRollFoam(foamField);
  const water = createWater(scene, heightMap, foamField);
  const stars = createStarField(THREE);
  stars.material.opacityNode = skyNight;
  const moonMaps = await loadMoonMaps();
  const moon = createMoonGlobe(THREE, createMoonMaterial(moonMaps));
  scene.add(stars, moon);
  const dressing = new THREE.Group();
  dressing.name = "Beach dressing";
  scene.add(dressing);

  const random = mulberry32(0xbec4a11);
  const [palmTemplate, rockTemplates] = await Promise.all([
    loadPalmTemplate(maps),
    loadRockTemplates(maps),
  ]);
  const palms = [];
  const palmSites = [
    [-18, -28, 1.05, 0.4],
    [-12, -36, 0.92, 1.2],
    [-22, -41, 1.18, 2.4],
    [16, -32, 1.0, 0.8],
    [24, -44, 1.22, 3.1],
    [9, -38, 0.86, 5.2],
    [-31, -34, 0.94, 1.7],
    [33, -29, 1.08, 4.4],
  ];
  for (const [x, z, scale, yaw] of palmSites) {
    palms.push(addPalm(dressing, palmTemplate, x, z, scale, yaw));
  }

  const rocks = [];
  const rockRandom = mulberry32(0x51a7c0de);
  for (let i = 0; i < 11; i += 1) {
    const x = -46 + rockRandom() * 92;
    const z = -4 + rockRandom() * 17;
    rocks.push(addRock(
      dressing,
      rockTemplates,
      i % rockTemplates.length,
      x,
      z,
      0.3 + rockRandom() * 0.52,
      rockRandom() * Math.PI * 2,
      0.82 + rockRandom() * 0.28,
    ));
  }
  for (let i = 0; i < 6; i += 1) {
    addDriftwood(dressing, maps, -20 + random() * 40, -4 + random() * 10, 1.6 + random() * 1.8, random() * Math.PI);
  }

  return {
    sky,
    lights,
    terrain,
    heightMap,
    water,
    foamField,
    dressing,
    palms,
    rocks,
    staticRoots: [terrain, dressing],
    sun: lights.sun,
    moonLight: lights.moonLight,
    stars,
    moon,
  };
}

export { WATER_LEVEL };
export { WORLD } from "./terrain.mjs";
