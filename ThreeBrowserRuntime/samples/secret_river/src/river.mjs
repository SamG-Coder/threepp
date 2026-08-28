import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  color,
  dot,
  float,
  mix,
  mx_fractal_noise_float,
  normalMap,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  reflector,
  saturate,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { riverEdgeZ, WORLD } from "./path.mjs";
import {
  CREEK_BREAK_BIAS,
  CREEK_BREAK_SCALE,
  CREEK_DEEP_OPACITY,
  CREEK_FRESNEL_BIAS,
  CREEK_FRESNEL_SCALE,
  CREEK_OPACITY_DEPTH,
  CREEK_SHORE_OPACITY,
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

  // Three differently oriented, aperiodic fields make rolling cells and
  // cross-current eddies. The former sine bands read as evenly spaced lines.
  const flow = riverTime.mul(0.34);
  const broadField = mx_fractal_noise_float(vec3(
    positionWorld.x.mul(0.052).sub(flow),
    positionWorld.z.mul(0.28).add(flow.mul(0.08)),
    riverTime.mul(0.018),
  ), 5, 2.03, 0.48);
  const crossField = mx_fractal_noise_float(vec3(
    positionWorld.x.mul(-0.11).add(positionWorld.z.mul(0.075)).add(flow.mul(0.42)),
    positionWorld.z.mul(0.19).sub(positionWorld.x.mul(0.026)).sub(flow.mul(0.16)),
    riverTime.mul(0.052),
  ), 4, 2.09, 0.51);
  const microField = mx_fractal_noise_float(vec3(
    positionWorld.x.mul(0.46).sub(positionWorld.z.mul(0.09)).sub(flow.mul(1.8)),
    positionWorld.z.mul(0.63).add(positionWorld.x.mul(0.07)).add(flow.mul(0.36)),
    riverTime.mul(0.14),
  ), 3, 2.17, 0.53);
  const surfaceNoise = broadField.mul(0.50)
    .add(crossField.mul(0.32))
    .add(microField.mul(0.18));
  const waveHeight = broadField.mul(0.18)
    .add(crossField.mul(0.11))
    .add(microField.mul(0.035));

  const shoreDistance = attribute("shoreDistance", "float").max(0);
  const noisyShoreDistance = shoreDistance
    .add(broadField.mul(0.16))
    .add(crossField.mul(0.08));
  const bankBlend = smoothstep(float(0.03), float(CREEK_OPACITY_DEPTH), noisyShoreDistance);
  const depthMix = smoothstep(float(0.25), float(10.5), shoreDistance);
  const shoreBand = float(1).sub(smoothstep(float(0.08), float(0.82), noisyShoreDistance));

  // Keep the photographed bank recognisable. Small noise-driven offsets
  // break the mirror into finite eddies without melting trunks into stripes.
  const distortion = vec2(
    broadField.mul(0.0048).add(microField.mul(0.0016)),
    crossField.mul(0.0035).sub(microField.mul(0.0011)),
  );
  reflection.uvNode = reflection.uvNode.add(distortion);
  const blurAmount = saturate(
    depthMix.mul(0.38)
      .add(abs(broadField).mul(0.36))
      .add(abs(microField).mul(0.18)),
  );
  reflection.levelNode = mix(float(0.12), float(1.08), blurAmount);

  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(saturate(float(1).sub(abs(dot(normalWorld, view)))), 3.4);
  const foamNoise = surfaceNoise.mul(0.5).add(0.5).saturate();
  const shoreFoam = shoreBand.mul(smoothstep(float(0.58), float(0.82), foamNoise));
  const broken = float(1)
    .sub(abs(crossField).mul(0.34))
    .sub(abs(microField).mul(0.28))
    .sub(shoreFoam.mul(0.58))
    .saturate();
  const reflectionWeight = fresnel.mul(CREEK_FRESNEL_SCALE).add(CREEK_FRESNEL_BIAS)
    .mul(broken.mul(CREEK_BREAK_SCALE).add(CREEK_BREAK_BIAS))
    .mul(mix(float(0.20), float(1), bankBlend))
    .saturate();

  const exposedBed = color(0x8a8062);
  const shallowOlive = color(0x596249);
  const tannin = color(0x344631);
  const deep = color(0x14251a);
  const shallows = mix(exposedBed, shallowOlive, smoothstep(float(0.08), float(1.5), shoreDistance));
  const body = mix(shallows, tannin, smoothstep(float(0.9), float(5.4), shoreDistance));
  const bodyShallow = mix(body, deep, pow(depthMix, 1.35).mul(0.58));

  const material = new THREE.MeshBasicNodeMaterial({
    name: "Australian river water",
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
  const reflected = reflection.rgb.mul(color(0xd2c5a5)).mul(0.86);
  const foam = color(0xd8cfb8).mul(shoreFoam.mul(0.11));
  const crestNoise = microField.mul(0.56)
    .add(crossField.mul(0.28))
    .add(broadField.mul(0.16))
    .mul(0.5).add(0.5).saturate();
  const surfaceGlint = color(0xc9bea0).mul(
    pow(crestNoise, 11).mul(0.055).mul(bankBlend),
  );
  material.colorNode = mix(bodyShallow, reflected, reflectionWeight)
    .add(foam)
    .add(surfaceGlint);
  const normalSample = vec3(
    broadField.mul(0.30).add(microField.mul(0.18)).mul(0.5).add(0.5),
    crossField.mul(0.34).sub(microField.mul(0.13)).mul(0.5).add(0.5),
    float(1),
  );
  material.normalNode = normalMap(normalSample, vec2(0.44, 0.34));
  material.positionNode = positionLocal.add(vec3(
    0,
    waveHeight.mul(0.024).mul(mix(float(0.12), float(1), bankBlend)),
    0,
  ));
  material.opacityNode = mix(
    float(CREEK_SHORE_OPACITY),
    float(CREEK_DEEP_OPACITY),
    bankBlend,
  );
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
