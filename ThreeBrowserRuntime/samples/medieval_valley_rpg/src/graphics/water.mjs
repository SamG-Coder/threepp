import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraPosition,
  color,
  dot,
  float,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  vec3,
} from "three/tsl";
import { graphicsTime, worldRain, worldWetness } from "./state.mjs";
import { riverCenterZ, terrainHeight } from "../world/terrain.mjs";

export function riverWidth(x) {
  return 13.5 + Math.sin(x * 0.018 + 0.8) * 2.3 + Math.sin(x * 0.057) * 0.8;
}

export function riverSurfaceHeight(x) {
  const z = riverCenterZ(x);
  // The surface follows the carved terrain, with a low-pass analytic bias that
  // keeps the long river legible as one continuous body of water.
  return terrainHeight(x, z) + 1.65 + Math.sin(x * 0.012) * 0.12;
}

function createRiverGeometry(samples = 150) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let index = 0; index <= samples; ++index) {
    const amount = index / samples;
    const x = THREE.MathUtils.lerp(-214, 214, amount);
    const z = riverCenterZ(x);
    const width = riverWidth(x);
    const y = riverSurfaceHeight(x);
    for (const side of [-1, 1]) {
      positions.push(x, y, z + width * 0.5 * side);
      uvs.push(amount * 18, (side + 1) * 0.5);
    }
    if (index < samples) {
      const a = index * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRiverMaterial() {
  const phaseA = positionWorld.x.mul(0.72)
    .add(positionWorld.z.mul(1.36))
    .sub(graphicsTime.mul(1.35));
  const phaseB = positionWorld.x.mul(1.82)
    .sub(positionWorld.z.mul(0.48))
    .add(graphicsTime.mul(1.83));
  const wave = sin(phaseA).mul(0.10).add(sin(phaseB).mul(0.035));
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(abs(dot(normalWorld, viewDirection))).saturate(), 4);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Animated valley river",
    color: 0x244f58,
    roughness: 0.16,
    metalness: 0.02,
    transmission: 0.18,
    transparent: true,
    opacity: 0.9,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y.add(wave.mul(worldRain.mul(0.7).add(0.45))),
    positionLocal.z,
  );
  material.normalNode = bumpMap(wave, 0.16);
  const deep = color(0x163c48);
  const sky = color(0x91aeb4);
  const stormDarkening = mix(float(0.82), float(0.54), worldRain);
  material.colorNode = mix(deep, sky, fresnel.mul(0.62)).mul(stormDarkening)
    .add(color(0xa8c8c4).mul(pow(sin(phaseA.mul(4)).mul(0.5).add(0.5), 18).mul(0.08)));
  material.roughnessNode = mix(float(0.24), float(0.10), worldWetness).add(worldRain.mul(0.1));
  material.rtxReflectionMask = 0.92;
  return material;
}

function createFoamMaterial() {
  const streak = sin(
    positionWorld.x.mul(1.9)
      .sub(graphicsTime.mul(4.1))
      .add(positionWorld.z.mul(0.7)),
  ).mul(0.5).add(0.5);
  const foam = smoothstep(0.47, 0.82, streak);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "River foam and mill wake",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.colorNode = mix(color(0xb9cfca), color(0xf1eee1), foam);
  material.opacityNode = foam.mul(worldRain.mul(0.22).add(0.52));
  material.rtxReflectionMask = 0;
  return material;
}

function createEdgeRibbon(side, material, samples = 120) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let index = 0; index <= samples; ++index) {
    const amount = index / samples;
    const x = THREE.MathUtils.lerp(-210, 210, amount);
    const edgeZ = riverCenterZ(x) + side * riverWidth(x) * 0.43;
    const y = riverSurfaceHeight(x) + 0.09;
    const ribbonWidth = 0.45 + Math.sin(index * 2.17) * 0.12;
    positions.push(x, y, edgeZ - ribbonWidth, x, y, edgeZ + ribbonWidth);
    uvs.push(amount * 24, 0, amount * 24, 1);
    if (index < samples) {
      const a = index * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = side < 0 ? "South riverbank foam" : "North riverbank foam";
  mesh.userData.rtxIgnore = true;
  mesh.frustumCulled = false;
  return mesh;
}

function createMillWheel(materials) {
  const group = new THREE.Group();
  group.name = "Working watermill wheel";
  const radius = 4.6;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.28, 8, 36), materials.wood);
  group.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 2.2, 12), materials.iron);
  hub.rotation.x = Math.PI * 0.5;
  group.add(hub);
  const spokeGeometry = new THREE.BoxGeometry(radius * 1.78, 0.19, 0.19);
  for (let index = 0; index < 8; ++index) {
    const spoke = new THREE.Mesh(spokeGeometry, materials.wood);
    spoke.rotation.z = index * Math.PI / 8;
    group.add(spoke);
  }
  const paddleGeometry = new THREE.BoxGeometry(0.35, 1.25, 2.5);
  for (let index = 0; index < 12; ++index) {
    const angle = index / 12 * Math.PI * 2;
    const paddle = new THREE.Mesh(paddleGeometry, materials.wood);
    paddle.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    paddle.rotation.z = angle;
    group.add(paddle);
  }
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return group;
}

function createMillWake(material) {
  const geometry = new THREE.PlaneGeometry(11, 4, 18, 2);
  geometry.rotateX(-Math.PI * 0.5);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Watermill churned wake";
  mesh.userData.rtxIgnore = true;
  return mesh;
}

/** Builds one animated river, reusable foam system and a working mill wheel. */
export function createRiver(materials) {
  const group = new THREE.Group();
  group.name = "River, ford and watermill motion";
  const waterMaterial = createRiverMaterial();
  const foamMaterial = createFoamMaterial();
  const river = new THREE.Mesh(createRiverGeometry(), waterMaterial);
  river.name = "Continuous river surface";
  river.receiveShadow = true;
  river.renderOrder = 2;
  river.userData.rtxIgnore = true;
  group.add(river);
  const foamSouth = createEdgeRibbon(-1, foamMaterial);
  const foamNorth = createEdgeRibbon(1, foamMaterial);
  group.add(foamSouth, foamNorth);

  const millX = 112;
  const millZ = riverCenterZ(millX) + riverWidth(millX) * 0.32;
  const millY = riverSurfaceHeight(millX) + 1.1;
  const wheel = createMillWheel(materials);
  wheel.position.set(millX, millY, millZ);
  group.add(wheel);
  const wake = createMillWake(foamMaterial);
  wake.position.set(millX - 4.8, riverSurfaceHeight(millX) + 0.16, riverCenterZ(millX));
  wake.rotation.y = -0.08;
  group.add(wake);

  return {
    group,
    river,
    wheel,
    millPosition: new THREE.Vector3(millX, terrainHeight(millX, millZ), millZ),
    update(_timeSeconds, deltaSeconds, state = {}) {
      const speed = THREE.MathUtils.clamp(Number(state.flow ?? 1), 0, 3);
      wheel.rotation.z -= Math.max(0, Number(deltaSeconds) || 0) * (0.45 + speed * 0.52);
    },
    dispose() {
      river.geometry.dispose();
      foamSouth.geometry.dispose();
      foamNorth.geometry.dispose();
      wake.geometry.dispose();
      const geometries = new Set();
      wheel.traverse((object) => {
        if (object.isMesh && object.geometry) geometries.add(object.geometry);
      });
      for (const geometry of geometries) geometry.dispose();
      waterMaterial.dispose();
      foamMaterial.dispose();
    },
  };
}
