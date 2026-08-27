import * as THREE from "three/webgpu";
import {
  attribute,
  bumpMap,
  float,
  mix,
  positionWorld,
  smoothstep as tslSmoothstep,
  texture,
  vec2,
} from "three/tsl";
import { loadGroundTextures } from "./ground-textures.mjs";
import {
  fbm,
  riverEdgeZ,
  roadCenterZ,
  terrainHeight,
  WORLD,
} from "./path.mjs";

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sampleNormal(x, z) {
  const epsilon = 0.45;
  const hL = terrainHeight(x - epsilon, z);
  const hR = terrainHeight(x + epsilon, z);
  const hD = terrainHeight(x, z - epsilon);
  const hU = terrainHeight(x, z + epsilon);
  return new THREE.Vector3(hL - hR, epsilon * 2, hD - hU).normalize();
}

function groundWeights(x, z) {
  const road = roadCenterZ(x);
  const river = riverEdgeZ(x);
  const noise = fbm(x * 0.19, z * 0.21);
  const fine = fbm(x * 0.47, z * 0.43);
  const distRoad = z - road;
  const roadSigma = WORLD.roadWidth * 0.42 + noise * 0.35;
  const dirt = THREE.MathUtils.clamp(
    Math.exp(-(distRoad * distRoad) / Math.max(1e-4, roadSigma * roadSigma)) * 1.22,
    0,
    1,
  );
  const mud = THREE.MathUtils.clamp(
    smoothstep(river - 1.2, river + 0.2, z)
      * (1 - smoothstep(river + 0.4, river + 2.4 + noise, z))
      * (1 - dirt * 0.7),
    0,
    1,
  );
  const inland = smoothstep(road + 1.4, road + 7.5, z);
  const shoulder = smoothstep(WORLD.roadWidth * 0.28, WORLD.roadWidth * 0.9, Math.abs(distRoad));
  const litter = THREE.MathUtils.clamp(
    (1 - dirt) * (1 - mud) * (
      shoulder * (0.35 + fine * 0.4)
      + inland * (0.22 + noise * 0.28)
      + (1 - inland) * fine * 0.18
    ),
    0,
    1,
  );
  const grass = Math.max(0, 1 - dirt - mud - litter);
  const sum = Math.max(1e-6, dirt + grass + litter + mud);
  return {
    dirt: dirt / sum,
    grass: grass / sum,
    litter: litter / sum,
    mud: mud / sum,
  };
}

function nodeMaterial(options) {
  const material = new THREE.MeshStandardNodeMaterial(options);
  if (options.vertexColors) material.colorNode = attribute("color", "vec3");
  return material;
}

export async function createTerrain() {
  const width = WORLD.maxX - WORLD.minX;
  const depth = WORLD.maxZ - WORLD.minZ;
  const geometry = new THREE.PlaneGeometry(width, depth, 180, 140);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.translate(
    (WORLD.minX + WORLD.maxX) * 0.5,
    0,
    (WORLD.minZ + WORLD.maxZ) * 0.5,
  );
  geometry.name = "Riverbank heightfield";
  const positions = geometry.getAttribute("position");
  const splat = new Float32Array(positions.count * 4);
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    positions.setY(index, terrainHeight(x, z));
    const weights = groundWeights(x, z);
    splat[index * 4] = weights.dirt;
    splat[index * 4 + 1] = weights.grass;
    splat[index * 4 + 2] = weights.litter;
    splat[index * 4 + 3] = weights.mud;
  }
  geometry.setAttribute("splat", new THREE.BufferAttribute(splat, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const maps = await loadGroundTextures();
  const uvWorld = vec2(positionWorld.x, positionWorld.z);
  const dirt = mix(
    texture(maps.dirt, uvWorld.mul(0.34)),
    texture(maps.dirt, uvWorld.mul(0.91).add(vec2(0.27, 0.13))),
    0.46,
  );
  const grass = mix(
    texture(maps.grass, uvWorld.mul(0.28)),
    texture(maps.grass, uvWorld.mul(0.74).add(vec2(0.18, 0.07))),
    0.22,
  );
  const litter = mix(
    texture(maps.litter, uvWorld.mul(0.52).add(vec2(0.41, 0.22))),
    texture(maps.litter, uvWorld.mul(0.83).add(vec2(0.11, 0.37))),
    0.35,
  );
  const mud = mix(
    texture(maps.mud, uvWorld.mul(0.3)),
    texture(maps.mud, uvWorld.mul(0.82).add(vec2(0.08, 0.31))),
    0.4,
  );
  const weights = attribute("splat", "vec4");
  const albedo = dirt.mul(weights.x)
    .add(grass.mul(weights.y))
    .add(litter.mul(weights.z))
    .add(mud.mul(weights.w));
  const shoreZ = float(WORLD.shoreZ);
  const bankMask = tslSmoothstep(shoreZ.sub(0.35), shoreZ.add(0.7), positionWorld.z)
    .mul(float(1).sub(tslSmoothstep(shoreZ.add(2.4), shoreZ.add(7.2), positionWorld.z)));
  const bankUv = vec2(
    positionWorld.x.mul(0.055).add(positionWorld.z.mul(0.012)),
    tslSmoothstep(float(0.02), float(2.35), positionWorld.y),
  );
  const bankFace = maps.bank ? texture(maps.bank, bankUv) : albedo;
  const bankMix = maps.bank ? bankMask.mul(0.32) : float(0);
  const material = new THREE.MeshStandardNodeMaterial({
    name: "Textured riverbank",
    roughness: 0.94,
    metalness: 0.02,
  });
  material.colorNode = mix(albedo, bankFace, bankMix);
  material.normalNode = bumpMap(albedo.r, 1.15);
  material.rtxReflectionMask = 0;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Riverbank terrain";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = "Hawkesbury bank";
  group.add(mesh);

  return {
    group,
    rtxRoots: [mesh],
    heightAt: terrainHeight,
    normalAt: sampleNormal,
    dispose() {
      geometry.dispose();
      material.dispose();
      maps.dirt.dispose();
      maps.grass.dispose();
      maps.litter.dispose();
      maps.mud.dispose();
      maps.bank?.dispose();
    },
  };
}

function createRoadRibbon(dirtMap) {
  const halfWidth = WORLD.roadWidth * 0.5;
  const samples = 220;
  const minX = WORLD.minX + 1;
  const maxX = WORLD.maxX - 1;
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  for (let sample = 0; sample <= samples; sample++) {
    const t = sample / samples;
    const x = minX + (maxX - minX) * t;
    const z = roadCenterZ(x);
    const yaw = Math.atan2(roadCenterZ(x + 0.4) - roadCenterZ(x - 0.4), 0.8);
    const sideX = -Math.sin(yaw);
    const sideZ = Math.cos(yaw);
    const y = terrainHeight(x, z) + 0.035;
    const leftX = x - sideX * halfWidth;
    const leftZ = z - sideZ * halfWidth;
    const rightX = x + sideX * halfWidth;
    const rightZ = z + sideZ * halfWidth;
    const leftY = terrainHeight(leftX, leftZ) + 0.03;
    const rightY = terrainHeight(rightX, rightZ) + 0.03;
    positions.push(leftX, Math.max(y, leftY), leftZ, rightX, Math.max(y, rightY), rightZ);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, t * 18, 1, t * 18);
    const straw = fbm(x * 0.55, z * 0.51);
    const packed = 0.38 + (sample % 7) * 0.008;
    colors.push(
      packed + 0.08 + straw * 0.10,
      packed * 0.68 + straw * 0.12,
      packed * 0.38 + straw * 0.04,
      packed + 0.04 + straw * 0.07,
      packed * 0.64 + straw * 0.10,
      packed * 0.34 + straw * 0.03,
    );
    if (sample < samples) {
      const base = sample * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = "Dirt road ribbon";
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Packed clay and straw road",
  });
  const roadUvA = vec2(positionWorld.x.mul(0.42), positionWorld.z.mul(0.42));
  const roadUvB = vec2(positionWorld.x.mul(1.05).add(0.19), positionWorld.z.mul(1.05).add(0.07));
  const dirt = mix(texture(dirtMap, roadUvA), texture(dirtMap, roadUvB), 0.42);
  material.colorNode = dirt;
  material.normalNode = bumpMap(dirt.r, 0.9);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Dirt road";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createRockInstances(geometry, material, count, inWaterBias, seed) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const span = WORLD.maxX - WORLD.minX - 10;
  for (let index = 0; index < count; index++) {
    const wander = fbm(index * 1.37 + seed, seed * 0.13);
    const x = WORLD.minX + 5 + ((index + wander * 0.45) / Math.max(1, count)) * span;
    const edge = riverEdgeZ(x);
    const scatter = fbm(index * 1.91, seed + 4.6) - 0.5;
    const wet = fbm(index * 0.73, seed + 9.2);
    const z = THREE.MathUtils.clamp(
      wet < inWaterBias
        ? edge - 0.4 - Math.abs(scatter) * 5.6
        : edge + 0.12 + Math.abs(scatter) * 2.35,
      WORLD.minZ + 1,
      WORLD.pathMinZ - 0.35,
    );
    const px = x + scatter * 2.2;
    const size = 0.20 + Math.pow(Math.abs(scatter) * 2, 1.35) * 0.58 + (index % 5) * 0.05;
    dummy.position.set(px, terrainHeight(px, z) + size * 0.26, z);
    dummy.rotation.set(index * 0.71, index * 1.13 + seed, index * 0.37);
    dummy.scale.set(size * 1.18, size * (0.42 + wet * 0.22), size * 0.96);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function createShoreRocks() {
  const dodecaGeometry = new THREE.DodecahedronGeometry(1, 0);
  const sphereGeometry = new THREE.SphereGeometry(1, 8, 6);
  dodecaGeometry.name = "River cobble";
  sphereGeometry.name = "River pebble";
  const cobbleMaterial = nodeMaterial({
    name: "Grey-brown river cobble",
    color: 0x8a8070,
    roughness: 0.82,
    metalness: 0.04,
    flatShading: false,
  });
  const pebbleMaterial = nodeMaterial({
    name: "Wet grey-brown river stone",
    color: 0x6a6560,
    roughness: 0.55,
    metalness: 0.08,
    flatShading: false,
  });
  const cobbles = createRockInstances(dodecaGeometry, cobbleMaterial, 44, 0.42, 2.7);
  cobbles.name = "Muddy-edge cobbles";
  const pebbles = createRockInstances(sphereGeometry, pebbleMaterial, 40, 0.78, 8.1);
  pebbles.name = "In-water river stones";
  return {
    meshes: [cobbles, pebbles],
    dispose() {
      dodecaGeometry.dispose();
      sphereGeometry.dispose();
      cobbleMaterial.dispose();
      pebbleMaterial.dispose();
    },
  };
}

function createFallenLogs() {
  const count = 7;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.name = "Fallen log";
  const material = nodeMaterial({
    name: "Weathered fallen timber",
    color: 0x4a3c28,
    roughness: 0.92,
    metalness: 0.02,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "Fallen logs";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; index++) {
    const t = (index + 0.32) / count;
    const x = WORLD.minX + 14 + t * (WORLD.maxX - WORLD.minX - 28);
    const scatter = fbm(index * 3.1, 11.4) - 0.5;
    const onShore = index % 2 === 0;
    let z;
    let yaw;
    if (onShore) {
      z = riverEdgeZ(x) + 0.35 + scatter * 2.1;
      yaw = scatter * 1.7;
    } else {
      const side = scatter >= 0 ? 1 : -1;
      z = roadCenterZ(x) + side * (WORLD.roadWidth * 0.42 + Math.abs(scatter) * 0.45);
      yaw = Math.atan2(roadCenterZ(x + 0.4) - roadCenterZ(x - 0.4), 0.8) + scatter * 0.55;
    }
    const length = 1.55 + Math.abs(scatter) * 1.7;
    const px = x + scatter * 2.6;
    dummy.position.set(px, terrainHeight(px, z) + 0.13, z);
    dummy.rotation.set(0.09 * scatter, yaw, 0.11 * scatter);
    dummy.scale.set(length, 0.22 + Math.abs(scatter) * 0.07, 0.30);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
