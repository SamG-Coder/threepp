import * as THREE from "three/webgpu";

const PRACTICAL_INDICES = Object.freeze([0, 1, 3, 5, 6, 8, 9, 10]);

export function createDowntownLighting(scene, buildingConfig) {
  scene.background = new THREE.Color(0x02050b);
  scene.fog = new THREE.FogExp2(0x07101c, 0.0076);

  const group = new THREE.Group();
  group.name = "Metropolitan rain lighting";
  scene.add(group);

  const ambient = new THREE.HemisphereLight(0x486b8b, 0x020309, 0.47);
  ambient.name = "Wet night sky ambient";
  group.add(ambient);

  const moon = new THREE.DirectionalLight(0x9ac6e8, 1.28);
  moon.name = "Storm-cloud directional key";
  moon.position.set(-24, 38, -18);
  moon.target.position.set(0, 3, 13);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -34;
  moon.shadow.camera.right = 34;
  moon.shadow.camera.top = 31;
  moon.shadow.camera.bottom = -12;
  moon.shadow.camera.near = 2;
  moon.shadow.camera.far = 120;
  moon.shadow.bias = -0.00055;
  moon.shadow.normalBias = 0.025;
  group.add(moon, moon.target);

  const practicals = [];
  for (let slot = 0; slot < PRACTICAL_INDICES.length; ++slot) {
    const facade = buildingConfig[PRACTICAL_INDICES[slot]];
    const color = new THREE.Color(facade.light);
    let light;
    if (slot === 0 || slot === 4) {
      light = new THREE.SpotLight(
        color,
        27 + facade.energy * 2,
        26,
        0.72,
        0.74,
        1.65,
      );
      light.target.position.set(facade.x + (slot === 0 ? 2 : -2), 0.15, -1.5);
      group.add(light.target);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.00045;
      light.shadow.normalBias = 0.02;
    } else {
      light = new THREE.PointLight(color, 20 + facade.energy * 3.1, 24, 1.72);
      light.castShadow = false;
    }
    light.name = "Storefront practical — " + (facade.id || facade.shell);
    light.position.set(facade.x, Math.min(6.2, facade.height * 0.36 + 1.1), 12.2);
    light.userData.baseIntensity = light.intensity;
    light.userData.phase = slot * 1.937;
    group.add(light);
    practicals.push(light);
  }

  const moonDirection = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let rayMode = false;

  function updateMoonDirection() {
    moonDirection.copy(moon.position).sub(moon.target.position).normalize();
  }
  updateMoonDirection();

  return {
    group,
    moon,
    ambient,
    practicals,
    rtxLights: practicals,
    moonDirection,
    setNativeRayMode(enabled) {
      rayMode = Boolean(enabled);
      // Native ray lighting is supplemental for this flat-card scene. Keep
      // the authored raster casters active so people, props and vehicles stay
      // grounded even though they are not part of the static native snapshot.
      moon.castShadow = true;
      for (let index = 0; index < practicals.length; ++index) {
        practicals[index].castShadow = index === 0 || index === 4;
      }
    },
    update(time, playerPosition, delta) {
      focus.set(playerPosition.x, 2.8, 12.5);
      const response = 1 - Math.exp(-Math.max(0, delta) * 5.2);
      moon.target.position.lerp(focus, response);
      const desiredMoon = focus.clone().add(new THREE.Vector3(-24, 38, -31));
      moon.position.lerp(desiredMoon, response);
      updateMoonDirection();
      for (const light of practicals) {
        const pulse = 0.95 + Math.sin(time * 0.71 + light.userData.phase) * 0.045;
        const flutter = Math.sin(time * 5.3 + light.userData.phase * 3.7) > 0.992 ? 0.64 : 1;
        light.intensity = light.userData.baseIntensity * pulse * flutter;
      }
    },
    dispose() {
      scene.remove(group);
    },
  };
}
