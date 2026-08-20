function startHelloCube() {
  const THREE = window.THREE;
  const status = document.getElementById("status");
  const canvas = document.getElementById("viewport");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, renderer.aspect, 0.1, 100);
  camera.position.z = 5;
  scene.add(new THREE.HemisphereLight());

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x22cc66 })
  );
  scene.add(mesh);

  const fit = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
  };
  window.addEventListener("resize", fit);
  fit();

  if (status) {
    status.textContent = "Native " + renderer.backend + " cube.";
  }

  const tick = () => {
    mesh.rotation.x += 0.01;
    mesh.rotation.y += 0.016;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}

if (window.THREE && window.THREE.WebGLRenderer) startHelloCube();
else window.addEventListener("three-ready", startHelloCube);
