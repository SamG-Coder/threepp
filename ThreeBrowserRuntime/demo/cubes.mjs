const THREE = globalThis.THREE;

const renderer = new THREE.WebGLRenderer({ width: 1280, height: 720 });
renderer.setSize(1280, 720);
renderer.setClearColor(0x0b1020);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
const camera = new THREE.PerspectiveCamera(55, 1280 / 720, 0.1, 100);
camera.position.z = 8;

const geometry = new THREE.BoxGeometry(0.72, 0.72, 0.72);
const cubes = [];
for (let y = -2; y <= 2; ++y) {
  for (let x = -4; x <= 4; ++x) {
    const color = new THREE.Color().setHSL((x + 4) / 9, 0.72, 0.55 + y * 0.025);
    const material = new THREE.MeshBasicMaterial({ color });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(x * 1.05, y * 1.05, 0);
    scene.add(cube);
    cubes.push(cube);
  }
}

let pointerX = 0;
let pointerY = 0;
renderer.domElement.addEventListener("pointermove", event => {
  pointerX = (event.clientX / Math.max(1, innerWidth) - 0.5) * 2;
  pointerY = (event.clientY / Math.max(1, innerHeight) - 0.5) * 2;
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function animate(time) {
  const seconds = time * 0.001;
  for (let index = 0; index < cubes.length; ++index) {
    const cube = cubes[index];
    cube.rotation.x = seconds * 0.55 + index * 0.035 + pointerY * 0.2;
    cube.rotation.y = seconds * 0.8 + index * 0.025 + pointerX * 0.2;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

console.log("ThreeBrowserRuntime: V8 is driving a native threepp window. Press Escape to exit.");
