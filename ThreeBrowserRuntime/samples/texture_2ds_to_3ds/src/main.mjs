import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { AnimeTextureRenderer } from "./anime-texture.mjs";
import { realWorldScale } from "./real-scale.mjs";
import { reconstructOrbitAsset, assetReport, ORBIT_SUBJECTS } from "./tree-asset.mjs";

document.title = "Texture 2Ds to 3Ds — ThreeBrowser Runtime";

function dataTexture(data, width, height, format, colorSpace = THREE.NoColorSpace) {
  const texture = new THREE.DataTexture(data, width, height, format);
  texture.needsUpdate = true;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createPhotoCards(views, radius) {
  const group = new THREE.Group();
  group.name = "Orbit photo cards";
  group.visible = false;
  for (const view of views) {
    if (!view.data) continue;
    const texture = dataTexture(
      view.data,
      view.width,
      view.height,
      THREE.RGBAFormat,
      THREE.SRGBColorSpace,
    );
    const aspect = view.width / Math.max(1, view.height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect * 2.4, 2.4), material);
    const yaw = view.yaw * Math.PI / 180;
    mesh.position.set(Math.sin(yaw) * radius, 1.35, Math.cos(yaw) * radius);
    mesh.lookAt(0, 1.2, 0);
    mesh.name = `photo ${view.label}`;
    group.add(mesh);
  }
  return group;
}

function createStudio(scene) {
  scene.background = new THREE.Color(0x4aa0e8);
  const hemi = new THREE.HemisphereLight(0xc8e8ff, 0x5a8c48, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2c8, 2.8);
  sun.position.set(-18, 28, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -8;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc5d4ea, 0.85);
  fill.position.set(8, 4, -6);
  scene.add(fill);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(24, 64),
    new THREE.MeshStandardMaterial({
      color: 0x6ec43a,
      roughness: 0.92,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = "studio ground";
  scene.add(ground);
  const sea = new THREE.Mesh(
    new THREE.RingGeometry(24.2, 90, 64),
    new THREE.MeshBasicMaterial({
      color: 0x3a88c8,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.12;
  sea.name = "ghibli sea";
  sea.userData.rtxIgnore = true;
  scene.add(sea);
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Texture 2Ds to 3Ds requires native WebGPU; there is no WebGL path.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#4aa0e8";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(1.6, Math.max(1, Number(globalThis.devicePixelRatio || 1))));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x4aa0e8, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.name = "Texture 2Ds to 3Ds studio";
  createStudio(scene);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / Math.max(1, innerHeight), 0.12, 160);
  const orbit = { yaw: 0.55, pitch: 0.22, distance: 36, dragging: false, lastX: 0, lastY: 0 };

  function placeCamera() {
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      Math.sin(orbit.yaw) * cp * orbit.distance,
      Math.sin(orbit.pitch) * orbit.distance + 1.4,
      Math.cos(orbit.yaw) * cp * orbit.distance,
    );
    camera.lookAt(0, 4.5, 2);
  }
  placeCamera();

  const photoGroups = [];
  for (const subject of ORBIT_SUBJECTS) {
    console.log(`[Texture 2Ds to 3Ds] reconstructing ${subject.label} from orbit stills…`);
    const asset = await reconstructOrbitAsset({
      assetRoot: import.meta.url,
      folder: subject.folder,
    });
    const report = assetReport(asset);
    const scale = realWorldScale(asset.mesh, subject);
    console.log(
      `[Texture 2Ds to 3Ds] ${subject.id}  shape=${report.kind}${report.generic ? " (generic)" : ""}  views=${report.recommendedCount}  ${subject.realHeight}m x ${subject.realWidth}m  voxels=${report.filled}  meanIoU=${report.meanIoU.toFixed(3)}  tris=${report.triangles}`,
    );
    for (const slice of report.slices) {
      console.log(`[Texture 2Ds to 3Ds] ${subject.id} slice yaw ${slice.yaw}°  IoU=${slice.iou.toFixed(3)}`);
    }

    const geometry = createGeometry(asset.mesh);
    const material = new THREE.MeshBasicMaterial({
      name: `${subject.label} photo isosurface`,
      vertexColors: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const object = new THREE.Mesh(geometry, material);
    object.name = `${subject.label} reconstructed`;
    object.scale.set(scale.x, scale.y, scale.z);
    object.position.y = -scale.extents.minY * scale.y;
    object.castShadow = true;
    object.receiveShadow = true;
    const plant = new THREE.Group();
    plant.name = subject.label;
    plant.position.set(subject.x, 0, subject.z ?? 0);
    plant.add(object);
    const photos = createPhotoCards(asset.views, Math.max(1.2, subject.realWidth * 0.4));
    plant.add(photos);
    photoGroups.push(photos);
    scene.add(plant);
  }

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const anime = new AnimeTextureRenderer(renderer, camera, rtx);
  const animeReady = await anime.setup(scene, innerWidth, innerHeight);
  console.log(
    `[Texture 2Ds to 3Ds] anime texture ${animeReady ? "ON (press A to toggle)" : `unavailable: ${anime.failure}`}`,
  );

  function onResize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    anime.resize(width, height);
  }

  renderer.domElement.addEventListener("pointerdown", event => {
    orbit.dragging = true;
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointerup", event => {
    orbit.dragging = false;
    renderer.domElement.releasePointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", event => {
    if (!orbit.dragging) return;
    orbit.yaw -= (event.clientX - orbit.lastX) * 0.005;
    orbit.pitch += (event.clientY - orbit.lastY) * 0.004;
    orbit.pitch = Math.min(1.15, Math.max(-0.08, orbit.pitch));
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;
    placeCamera();
  });
  renderer.domElement.addEventListener("wheel", event => {
    event.preventDefault();
    orbit.distance = Math.min(70, Math.max(8, orbit.distance + event.deltaY * 0.01));
    placeCamera();
  }, { passive: false });

  globalThis.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (key === "a" && anime.enabled) {
      anime.active = !anime.active;
      console.log(`[Texture 2Ds to 3Ds] anime texture ${anime.active ? "ON" : "OFF"}`);
    }
    if (key === "p") {
      const show = !photoGroups[0]?.visible;
      for (const group of photoGroups) group.visible = show;
    }
    if (key === "r") {
      orbit.yaw = 0.55;
      orbit.pitch = 0.22;
      orbit.distance = 36;
      placeCamera();
    }
  });
  globalThis.addEventListener("resize", onResize);

  renderer.setAnimationLoop(() => {
    const animePresented = anime.render(scene, camera);
    if (!animePresented) renderer.render(scene, camera);
  });
}

main().catch(error => {
  console.error("[Texture 2Ds to 3Ds]", error);
  throw error;
});
