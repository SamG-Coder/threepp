import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  bumpMap,
  cameraPosition,
  color,
  cos,
  dot,
  float,
  mix,
  mx_fractal_noise_float,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  reflector,
  saturate,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { riverEdgeZ, WORLD } from "./path.mjs";
import {
  CREEK_BREAK_BIAS,
  CREEK_BREAK_SCALE,
  CREEK_FRESNEL_BIAS,
  CREEK_FRESNEL_SCALE,
} from "./creek-mix.mjs";

const riverTime = uniform(0);

function buildRiverGeometry() {
  const segmentsX = 220;
  const segmentsZ = 40;
  const positions = [];
  const uvs = [];
  const shoreDistances = [];
  const indices = [];
  for (let iz = 0; iz <= segmentsZ; iz++) {
    const v = iz / segmentsZ;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const t = ix / segmentsX;
      const x = WORLD.minX - 10 + t * (WORLD.maxX - WORLD.minX + 20);
      const shore = riverEdgeZ(x);
      const z = WORLD.waterMinZ + v * (shore - WORLD.waterMinZ);
      positions.push(x, 0, z);
      uvs.push(x * 0.14, v);
      shoreDistances.push(Math.max(0, shore - z));
    }
  }
  const cols = segmentsX + 1;
  for (let iz = 0; iz < segmentsZ; iz++) {
    for (let ix = 0; ix < segmentsX; ix++) {
      const a = iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "shoreDistance",
    new THREE.Float32BufferAttribute(shoreDistances, 1),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = "River surface";
  return geometry;
}

export function createRiver() {
  const geometry = buildRiverGeometry();

  const reflection = reflector({
    resolutionScale: 0.62,
    generateMipmaps: true,
    bounces: false,
    samples: 1,
  });

  // Advect along +X so current, streaks and ripples travel down the creek.
  const flow = riverTime.mul(1.05);
  const advectedX = positionWorld.x.sub(flow);
  const currentField = mx_fractal_noise_float(
    vec3(advectedX.mul(0.048), float(0.18), positionWorld.z.mul(0.52)),
    5,
    2.03,
    0.48,
  );
  const rippleField = mx_fractal_noise_float(
    vec3(advectedX.mul(0.22), riverTime.mul(0.08), positionWorld.z.mul(0.85)),
    3,
    2.11,
    0.52,
  );
  const phaseA = advectedX.mul(0.46).add(positionWorld.z.mul(0.11));
  const phaseB = advectedX.mul(1.08).sub(positionWorld.z.mul(0.19)).sub(flow.mul(0.35));
  const phaseC = advectedX.mul(2.35).add(positionWorld.z.mul(0.27));
  const waveHeight = sin(phaseA).mul(0.22)
    .add(sin(phaseB).mul(0.13))
    .add(sin(phaseC).mul(0.045))
    .add(currentField.mul(0.16));
  const slopeX = cos(phaseA).mul(0.46)
    .add(cos(phaseB).mul(0.22))
    .add(currentField.mul(0.28))
    .add(rippleField.mul(0.12));
  const slopeZ = cos(phaseA).mul(0.08)
    .add(cos(phaseB).mul(0.16))
    .add(rippleField.mul(0.09));
  const waveNormal = bumpMap(waveHeight.add(rippleField.mul(0.08)), 0.42);

  // Keep the photographed bank recognisable. Small current-aligned offsets
  // break the mirror without melting trunks into broad vertical smears.
  const distortion = vec2(
    slopeX.mul(0.0062).add(currentField.mul(0.0035)),
    slopeZ.mul(0.0032),
  );
  reflection.uvNode = reflection.uvNode.add(distortion);
  const nearWater = float(1).sub(uv().y);
  const blurAmount = saturate(
    nearWater.mul(0.62)
      .add(abs(currentField).mul(0.22))
      .add(abs(rippleField).mul(0.12)),
  );
  reflection.levelNode = mix(float(0.16), float(1.15), blurAmount);

  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(saturate(float(1).sub(abs(dot(normalWorld, view)))), 3.4);
  const shoreDistance = attribute("shoreDistance", "float").max(0);
  const shoreBand = float(1).sub(smoothstep(float(0.12), float(0.66), shoreDistance));
  const shoreBreakup = sin(advectedX.mul(1.32).add(currentField.mul(2.1)))
    .mul(0.5).add(0.5)
    .mul(sin(advectedX.mul(0.37).sub(riverTime.mul(0.8))).mul(0.28).add(0.72));
  const shoreFoam = shoreBand.mul(shoreBreakup);
  const lanes = saturate(sin(positionWorld.z.mul(0.78).add(currentField.mul(1.7))).mul(0.5).add(0.5));
  const streaks = saturate(
    sin(phaseA.mul(1.85).add(currentField.mul(2.3))).mul(0.5).add(0.5)
      .mul(lanes.mul(0.55).add(0.45)),
  );
  const broken = float(1)
    .sub(streaks.mul(0.62))
    .sub(abs(currentField).mul(0.22))
    .sub(shoreFoam.mul(0.75))
    .saturate();
  const reflectionWeight = fresnel.mul(CREEK_FRESNEL_SCALE).add(CREEK_FRESNEL_BIAS)
    .mul(broken.mul(CREEK_BREAK_SCALE).add(CREEK_BREAK_BIAS))
    .saturate();

  const deep = color(0x1a2818);
  const tannin = color(0x3a4a32);
  const silt = color(0x6a6850);
  const depth = smoothstep(float(-18), float(12), positionWorld.z);
  const shallow = smoothstep(float(0.58), float(0.97), uv().y);
  const body = mix(deep, tannin, depth);
  const bodyShallow = mix(body, silt, shallow.mul(0.35));

  const material = new THREE.MeshBasicNodeMaterial({
    name: "Australian river water",
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  const reflected = reflection.rgb.mul(color(0xd8c8a8)).mul(0.92);
  const foam = color(0xd8cfb8).mul(shoreFoam.mul(0.16));
  const currentGlint = color(0xc4b898).mul(
    pow(saturate(sin(phaseB.mul(2.1)).mul(0.5).add(0.5)), 10).mul(0.06),
  );
  material.colorNode = mix(bodyShallow, reflected, reflectionWeight)
    .add(foam)
    .add(currentGlint);
  material.normalNode = waveNormal;
  material.positionNode = positionLocal.add(vec3(0, waveHeight.mul(0.026), 0));
  material.opacityNode = mix(float(0.94), float(0.76), shoreBand.mul(0.82));
  material.alphaTest = 0.01;
  material.rtxReflectionMask = 0;
  material.userData.rtxIgnore = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "River";
  mesh.position.y = WORLD.waterHeight + 0.04;
  mesh.receiveShadow = false;
  mesh.userData.rtxIgnore = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  reflection.target.name = "River reflector";
  // Unrotated XZ mesh: ReflectorNode treats local +Z as the plane normal.
  reflection.target.rotation.x = -Math.PI * 0.5;
  mesh.add(reflection.target);

  return {
    mesh,
    reflection,
    update(elapsed) {
      riverTime.value = elapsed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      reflection.dispose();
    },
  };
}

export function riverCovers(x, z) {
  return z >= WORLD.waterMinZ && z <= riverEdgeZ(x);
}
