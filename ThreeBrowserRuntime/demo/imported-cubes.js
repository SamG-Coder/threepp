import * as THREE from "three";

export function startImportedCubes() {
  const renderer = new THREE.WebGLRenderer({ width: 1280, height: 720 });
  renderer.setSize(1280, 720);
  renderer.setClearColor(0x0b1020);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1280 / 720, 0.1, 100);
  camera.position.z = 6;

  const cubes = [-1.4, 0, 1.4].map((x, index) => {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: [0x2f80ed, 0x42d392, 0xe34ba9][index] }),
    );
    cube.position.x = x;
    scene.add(cube);
    return cube;
  });

  renderer.setAnimationLoop(time => {
    for (let index = 0; index < cubes.length; ++index) {
      cubes[index].rotation.x = time * 0.0005 + index * 0.3;
      cubes[index].rotation.y = time * 0.0008 + index * 0.2;
    }
    renderer.render(scene, camera);
  });
}
