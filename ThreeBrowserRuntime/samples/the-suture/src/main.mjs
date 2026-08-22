import * as THREE from "three";
import {
  atmosphereFragment,
  atmosphereVertex,
  basinFragment,
  basinVertex,
  finFragment,
  finVertex,
  sculptureFragment,
  sculptureVertex,
  sutureFragment,
  sutureVertex,
} from "./shaders.mjs";

const palette = {
  void: new THREE.Color(0x050607),
  graphite: new THREE.Color(0x101214),
  porcelain: new THREE.Color(0xe7ddc7),
  signal: new THREE.Color(0xff3b16),
  hot: new THREE.Color(0xfff5df),
};

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.35));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(palette.void, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.background = palette.void.clone();

const camera = new THREE.PerspectiveCamera(38, innerWidth / Math.max(1, innerHeight), 0.04, 150);
camera.position.set(8.4, 2.35, 13.2);
camera.lookAt(-0.85, 2.25, 0);

const state = {
  pointer: new THREE.Vector2(),
  pointerTarget: new THREE.Vector2(),
  elapsed: 0,
  paused: false,
  held: false,
  open: 0,
  openTarget: 0,
  waveBirth: 0,
  distance: 15.7,
  drift: true,
};

const sculptureCenter = new THREE.Vector3(-0.9, 3.0, 0);
const basinY = -2.56;
const liveUniforms = [];

function registerUniforms(uniforms) {
  liveUniforms.push(uniforms);
  return uniforms;
}

function mobiusPoint(u, v, target = new THREE.Vector3()) {
  const radius = 3.82;
  const half = u * 0.5;
  const radial = radius + v * Math.cos(half);
  return target.set(
    radial * Math.cos(u),
    radial * Math.sin(u),
    v * Math.sin(half),
  );
}

function mobiusCross(u, target = new THREE.Vector3()) {
  const half = u * 0.5;
  return target.set(
    Math.cos(half) * Math.cos(u),
    Math.cos(half) * Math.sin(u),
    Math.sin(half),
  ).normalize();
}

function createSplitMobiusGeometry() {
  const alongSegments = 1024;
  const acrossSegments = 96;
  const halfWidth = 1.62;
  const seamGap = 0.105;
  const positions = [];
  const alongValues = [];
  const acrossValues = [];
  const halfValues = [];
  const crossValues = [];
  const indices = [];
  const point = new THREE.Vector3();
  const cross = new THREE.Vector3();

  // Cutting a Möbius strip down its centre creates one strip that is twice as
  // long, not two disconnected halves. Traversing 0..4PI keeps the porcelain
  // continuous while leaving only the intentional central wound exposed.
  for (let alongIndex = 0; alongIndex <= alongSegments; ++alongIndex) {
    const longAlong = alongIndex / alongSegments;
    const u = longAlong * Math.PI * 4;
    const seamAlong = (longAlong * 2) % 1;
    mobiusCross(u, cross);
    for (let acrossIndex = 0; acrossIndex <= acrossSegments; ++acrossIndex) {
      const acrossRatio = acrossIndex / acrossSegments;
      const v = seamGap + (halfWidth - seamGap) * acrossRatio;
      mobiusPoint(u, v, point);
      positions.push(point.x, point.y, point.z);
      alongValues.push(seamAlong);
      acrossValues.push(v / halfWidth);
      halfValues.push(1);
      crossValues.push(cross.x, cross.y, cross.z);
    }
  }

  const stride = acrossSegments + 1;
  for (let alongIndex = 0; alongIndex < alongSegments; ++alongIndex) {
    for (let acrossIndex = 0; acrossIndex < acrossSegments; ++acrossIndex) {
      const a = alongIndex * stride + acrossIndex;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(alongValues), 1));
  geometry.setAttribute("aAcross", new THREE.BufferAttribute(new Float32Array(acrossValues), 1));
  geometry.setAttribute("aHalf", new THREE.BufferAttribute(new Float32Array(halfValues), 1));
  geometry.setAttribute("aCross", new THREE.BufferAttribute(new Float32Array(crossValues), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function sculptureUniforms() {
  return registerUniforms({
    uTime: { value: 0 },
    uOpen: { value: 0 },
    uWave: { value: 0 },
    uPointer: { value: state.pointer },
    uPorcelain: { value: palette.porcelain },
    uGraphite: { value: palette.graphite },
    uSignal: { value: palette.signal },
  });
}

const sculptureGeometry = createSplitMobiusGeometry();
const sculptureMaterial = new THREE.ShaderMaterial({
  vertexShader: sculptureVertex,
  fragmentShader: sculptureFragment,
  uniforms: sculptureUniforms(),
  side: THREE.DoubleSide,
});
const sculpture = new THREE.Mesh(sculptureGeometry, sculptureMaterial);
sculpture.position.copy(sculptureCenter);
scene.add(sculpture);

const sutureUniforms = registerUniforms({
  uTime: { value: 0 },
  uWave: { value: 0 },
  uOpen: { value: 0 },
  uSignal: { value: palette.signal },
  uHot: { value: palette.hot },
});
const sutureMaterial = new THREE.ShaderMaterial({
  vertexShader: sutureVertex,
  fragmentShader: sutureFragment,
  uniforms: sutureUniforms,
});

const seamPoints = [];
for (let index = 0; index < 384; ++index) {
  seamPoints.push(mobiusPoint((index / 384) * Math.PI * 2, 0));
}
const seamCurve = new THREE.CatmullRomCurve3(seamPoints, true, "centripetal", 0.5);
const seam = new THREE.Mesh(
  new THREE.TubeGeometry(seamCurve, 1024, 0.052, 10, true),
  sutureMaterial,
);
seam.position.copy(sculptureCenter);
scene.add(seam);

const stitchCount = 320;
const stitchGeometry = new THREE.BoxGeometry(0.44, 0.044, 0.052, 2, 1, 1);
const stitches = new THREE.InstancedMesh(stitchGeometry, sutureMaterial, stitchCount);
const stitchDummy = new THREE.Object3D();
const stitchPoint = new THREE.Vector3();
const stitchCross = new THREE.Vector3();
const stitchAxis = new THREE.Vector3(1, 0, 0);
for (let index = 0; index < stitchCount; ++index) {
  const u = (index / stitchCount) * Math.PI * 2;
  mobiusPoint(u, 0, stitchPoint);
  mobiusCross(u, stitchCross);
  stitchDummy.position.copy(stitchPoint);
  stitchDummy.quaternion.setFromUnitVectors(stitchAxis, stitchCross);
  const cadence = index % 16 === 0 ? 1.65 : 1;
  stitchDummy.scale.set(1, cadence, cadence);
  stitchDummy.updateMatrix();
  stitches.setMatrixAt(index, stitchDummy.matrix);
}
stitches.instanceMatrix.needsUpdate = true;
stitches.position.copy(sculptureCenter);
scene.add(stitches);

const basinUniforms = registerUniforms({
  uTime: { value: 0 },
  uWave: { value: 0 },
  uGraphite: { value: palette.graphite },
  uPorcelain: { value: palette.porcelain },
  uSignal: { value: palette.signal },
});
const basin = new THREE.Mesh(
  new THREE.PlaneGeometry(23.5, 15.0, 256, 164),
  new THREE.ShaderMaterial({
    vertexShader: basinVertex,
    fragmentShader: basinFragment,
    uniforms: basinUniforms,
    side: THREE.DoubleSide,
  }),
);
basin.position.set(sculptureCenter.x, basinY, 0);
basin.rotation.x = -Math.PI * 0.5;
scene.add(basin);

const fieldUniforms = registerUniforms({
  uTime: { value: 0 },
  uWave: { value: 0 },
  uOpen: { value: 0 },
  uCenter: { value: new THREE.Vector2(sculptureCenter.x, sculptureCenter.z) },
  uGraphite: { value: palette.graphite },
  uPorcelain: { value: palette.porcelain },
  uSignal: { value: palette.signal },
});
const finGeometry = new THREE.BoxGeometry(0.025, 1, 0.15, 1, 4, 1);
const finMaterial = new THREE.ShaderMaterial({
  vertexShader: finVertex,
  fragmentShader: finFragment,
  uniforms: fieldUniforms,
});
const fieldColumns = 160;
const fieldRows = 126;
const finCount = fieldColumns * fieldRows;
const field = new THREE.InstancedMesh(finGeometry, finMaterial, finCount);
const finDummy = new THREE.Object3D();
let finIndex = 0;
for (let row = 0; row < fieldRows; ++row) {
  const z = (row - (fieldRows - 1) * 0.5) * 0.225;
  for (let column = 0; column < fieldColumns; ++column) {
    const x = (column - (fieldColumns - 1) * 0.5) * 0.225 + sculptureCenter.x;
    const localX = x - sculptureCenter.x;
    const insideBasin = Math.abs(localX) < 11.9 && Math.abs(z) < 7.65;
    const radius = Math.sqrt(localX * localX + z * z);
    const fieldAngle = Math.atan2(z, localX);
    const ordered = 0.5 + 0.5 * Math.sin(radius * 0.78 - fieldAngle * 4.0);
    const arch = Math.pow(0.5 + 0.5 * Math.cos(fieldAngle * 6.0 + radius * 0.16), 3);
    const height = insideBasin ? 0.012 : 0.18 + ordered * 0.72 + arch * 0.9;
    finDummy.position.set(x, basinY + height * 0.5 - (insideBasin ? 0.12 : 0), z);
    finDummy.rotation.set(0, fieldAngle + Math.sin(radius * 0.31) * 0.38, 0);
    finDummy.scale.set(1, height, 0.72 + ordered * 0.38);
    finDummy.updateMatrix();
    field.setMatrixAt(finIndex++, finDummy.matrix);
  }
}
field.instanceMatrix.needsUpdate = true;
scene.add(field);

const atmosphereUniforms = registerUniforms({
  uTime: { value: 0 },
  uPointer: { value: state.pointer },
});
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(62, 80, 52),
  new THREE.ShaderMaterial({
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    uniforms: atmosphereUniforms,
    side: THREE.BackSide,
    depthWrite: false,
  }),
);
scene.add(atmosphere);

const clock = new THREE.Clock();

function updatePointer(event) {
  state.pointerTarget.set(
    (event.clientX / Math.max(1, innerWidth)) * 2 - 1,
    -((event.clientY / Math.max(1, innerHeight)) * 2 - 1),
  );
}

function releaseSuture() {
  if (!state.held) return;
  state.held = false;
  state.openTarget = 0;
  state.waveBirth = state.elapsed;
}

renderer.domElement.addEventListener("pointermove", updatePointer);
renderer.domElement.addEventListener("pointerdown", () => {
  state.held = true;
  state.openTarget = 1;
});
addEventListener("pointerup", releaseSuture);
addEventListener("blur", releaseSuture);
renderer.domElement.addEventListener("wheel", (event) => {
  state.distance = THREE.MathUtils.clamp(state.distance + Math.sign(event.deltaY) * 0.9, 11.5, 22.0);
});

addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    state.paused = !state.paused;
    event.preventDefault();
  } else if (event.code === "KeyO") {
    state.drift = !state.drift;
  } else if (event.code === "KeyR") {
    state.pointerTarget.set(0, 0);
    state.openTarget = 0;
    state.waveBirth = state.elapsed;
    state.distance = 15.7;
    state.drift = true;
  }
});

addEventListener("resize", () => {
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

function animate() {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.04);
  if (!state.paused) state.elapsed += rawDelta;
  const time = state.elapsed;
  const waveAge = Math.max(0, time - state.waveBirth);
  const wavePhase = waveAge % 6.0;
  state.pointer.lerp(state.pointerTarget, 1.0 - Math.exp(-delta * 6.0));
  state.open += (state.openTarget - state.open) * (1.0 - Math.exp(-delta * 4.6));

  for (const uniforms of liveUniforms) {
    if (uniforms.uTime) uniforms.uTime.value = time;
    if (uniforms.uWave) uniforms.uWave.value = wavePhase;
    if (uniforms.uOpen) uniforms.uOpen.value = state.open;
  }

  atmosphere.position.copy(camera.position);
  const slowDrift = state.drift ? Math.sin(time * 0.035) * 0.105 : 0;
  const azimuth = -0.565 + slowDrift + state.pointer.x * 0.075;
  const elevation = 2.25 + state.pointer.y * 0.52;
  const targetX = sculptureCenter.x + Math.sin(azimuth) * state.distance;
  const targetZ = sculptureCenter.z + Math.cos(azimuth) * state.distance;
  const smoothing = 1.0 - Math.exp(-delta * 3.2);
  camera.position.x += (targetX - camera.position.x) * smoothing;
  camera.position.y += (elevation - camera.position.y) * smoothing;
  camera.position.z += (targetZ - camera.position.z) * smoothing;
  camera.lookAt(sculptureCenter.x - 0.35, sculptureCenter.y - 0.55, sculptureCenter.z);

  const response = state.open * 0.018 + Math.exp(-waveAge * 1.7) * 0.012;
  sculpture.rotation.y = state.pointer.x * 0.025;
  sculpture.rotation.z = -0.025 + response;
  seam.rotation.copy(sculpture.rotation);
  stitches.rotation.copy(sculpture.rotation);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
console.log("The Suture ready — original JS/MJS shader sculpture: ~200k parametric triangles, 20,160 fin instances, 320 stitch instances, dense seam tube, displaced basin, and 40-sample background light volume.");
console.log("Hold pointer to open the seam; release to launch its pulse. Wheel dollies, Space pauses, O toggles drift, R resets.");
