function startBatchLod() {
  const THREE = window.THREE;
  const native = chrome.webview.hostObjects.sync.native;
  const status = document.getElementById("status");
  const setStatus = (t) => { if (status) status.textContent = t; };
  try {
    const canvas = document.getElementById("viewport");

    const renderer = new THREE.WebGLRenderer({
      canvas,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;

    const scene = new THREE.Scene();
    scene.background = 0x111111;

    const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 0.1, 4000);
    camera.position.x = 0;
    camera.position.y = 20;
    camera.position.z = 55;
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight());
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.x = 12;
    sun.position.y = 28;
    sun.position.z = 18;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x6688aa, 0.45));

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.8,
    });

    const instances = 500000;
    setStatus("Building 500,000 instances…");
    const geo = new THREE.TorusKnotGeometry(1, 0.4, 12, 6, 2, 3);
    const batched = new THREE.InstancedMesh(geo, material, instances);
    batched.fillGrid(5.5);
    scene.add(batched);

    const target = { x: 0, y: 0, z: 0 };
    let radius = 58;
    let theta = 0;
    let phi = 1.22;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    let cameraDirty = true;
    const applyCamera = () => {
      const x = target.x + radius * Math.sin(phi) * Math.sin(theta);
      const y = target.y + radius * Math.cos(phi);
      const z = target.z + radius * Math.sin(phi) * Math.cos(theta);
      native.ObjectLookFrom(camera._h, x, y, z, target.x, target.y, target.z);
      cameraDirty = false;
    };

    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("pointerup", () => {
      dragging = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.005;
      phi -= (e.clientY - lastY) * 0.005;
      phi = Math.max(0.08, Math.min(Math.PI / 2 - 0.04, phi));
      lastX = e.clientX;
      lastY = e.clientY;
      cameraDirty = true;
      requestTick();
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        radius *= e.deltaY > 0 ? 1.08 : 0.92;
        radius = Math.max(10, Math.min(900, radius));
        cameraDirty = true;
        requestTick();
      },
      { passive: true }
    );

    const fit = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", fit);
    fit();

    if (status) {
      status.textContent =
        instances.toLocaleString() + " native InstancedMesh torus knots (one draw). Drag / scroll to orbit.";
    }

    let ticking = false;
    const tick = () => {
      ticking = false;
      if (cameraDirty) applyCamera();
      if (dragging || cameraDirty) {
        ticking = true;
        requestAnimationFrame(tick);
      }
    };
    const requestTick = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(tick);
      }
    };

    renderer.render(scene, camera);
    applyCamera();
  } catch (err) {
    setStatus(String(err));
    console.error(err);
  }
}

if (window.THREE && window.THREE.WebGLRenderer) startBatchLod();
else window.addEventListener("three-ready", startBatchLod);
