import * as THREE from "three/webgpu";

export const LIGHTING_RIG_NAMES = Object.freeze(["dawn", "overcast", "lantern", "studio"]);

const RIG_COUNT = LIGHTING_RIG_NAMES.length;
const LOOK_TARGET = Object.freeze([0.46, 1.14, 0.02]);

// Directional key + fill/rim stay off the RTX packed-light list (points/spots
// only, cap 8). Paper-lantern PointLights are authored in lanterns.mjs.
const RIGS = Object.freeze([
  Object.freeze({
    name: "dawn",
    keyPosition: [1.6, 4.8, 1.4],
    keyColor: 0xffe6c4,
    keyIntensity: 6.4,
    fillPosition: [-2.2, 2.4, 1.8],
    fillColor: 0x7eb0ea,
    fillIntensity: 1.8,
    rimPosition: [-0.4, 2.2, -2.4],
    rimColor: 0xa8d4ff,
    rimIntensity: 2.4,
    hemiSky: 0xc4ddf4,
    hemiGround: 0x1a120c,
    hemiIntensity: 0.55,
  }),
  Object.freeze({
    name: "overcast",
    keyPosition: [6, 18, 9],
    keyColor: 0xd5dbe2,
    keyIntensity: 0.28,
    fillPosition: [-8, 10, 4],
    fillColor: 0xc8d0d6,
    fillIntensity: 0.16,
    rimPosition: [2, 12, -10],
    rimColor: 0xcfd4da,
    rimIntensity: 0,
    hemiSky: 0xc5cdd4,
    hemiGround: 0x4a5248,
    hemiIntensity: 0.82,
  }),
  Object.freeze({
    name: "lantern",
    keyPosition: [8, 14, 5],
    keyColor: 0xffb978,
    keyIntensity: 0.08,
    fillPosition: [-6, 4, 6],
    fillColor: 0xffc090,
    fillIntensity: 0,
    rimPosition: [1, 7, -11],
    rimColor: 0xffd2a0,
    rimIntensity: 0,
    hemiSky: 0x3a2818,
    hemiGround: 0x0c0806,
    hemiIntensity: 0.12,
  }),
  Object.freeze({
    name: "studio",
    keyPosition: [10, 13, 11],
    keyColor: 0xf4f6f8,
    keyIntensity: 1.85,
    fillPosition: [-12, 6, 8],
    fillColor: 0xeef1f4,
    fillIntensity: 0.72,
    rimPosition: [2, 10, -14],
    rimColor: 0xffffff,
    rimIntensity: 1.15,
    hemiSky: 0xe8e8ee,
    hemiGround: 0x2a2a30,
    hemiIntensity: 0.28,
  }),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function wrapRigIndex(value) {
  return ((Math.trunc(finite(value)) % RIG_COUNT) + RIG_COUNT) % RIG_COUNT;
}

function configureShadow(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -6;
  light.shadow.camera.right = 6;
  light.shadow.camera.top = 6;
  light.shadow.camera.bottom = -6;
  light.shadow.camera.near = 0.4;
  light.shadow.camera.far = 22;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.018;
  return light;
}

function createDirectional(name, color, intensity, position) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.name = name;
  light.position.set(...position);
  light.target.position.set(...LOOK_TARGET);
  return light;
}

/** Directional key + hemisphere + fill/rim. Four looks; lantern relies on scene PointLights. */
export function createLightingRigs(scene) {
  if (!scene?.isScene) throw new TypeError("createLightingRigs requires a THREE.Scene.");

  const dawn = RIGS[0];
  const key = configureShadow(createDirectional(
    "Morpho greenhouse key",
    dawn.keyColor,
    dawn.keyIntensity,
    dawn.keyPosition,
  ));
  const fill = createDirectional(
    "Morpho greenhouse fill",
    dawn.fillColor,
    dawn.fillIntensity,
    dawn.fillPosition,
  );
  const rim = createDirectional(
    "Morpho greenhouse rim",
    dawn.rimColor,
    dawn.rimIntensity,
    dawn.rimPosition,
  );
  const hemisphere = new THREE.HemisphereLight(dawn.hemiSky, dawn.hemiGround, dawn.hemiIntensity);
  hemisphere.name = "Morpho greenhouse hemisphere";

  const group = new THREE.Group();
  group.name = "Morpho greenhouse lighting rig";
  group.add(key, key.target, fill, fill.target, rim, rim.target, hemisphere);
  scene.add(group);

  let rigIndex = 0;

  function applyRig(rig) {
    key.position.set(...rig.keyPosition);
    key.color.setHex(rig.keyColor);
    key.intensity = rig.keyIntensity;
    key.target.position.set(...LOOK_TARGET);
    fill.position.set(...rig.fillPosition);
    fill.color.setHex(rig.fillColor);
    fill.intensity = rig.fillIntensity;
    fill.target.position.set(...LOOK_TARGET);
    rim.position.set(...rig.rimPosition);
    rim.color.setHex(rig.rimColor);
    rim.intensity = rig.rimIntensity;
    rim.target.position.set(...LOOK_TARGET);
    hemisphere.color.setHex(rig.hemiSky);
    hemisphere.groundColor.setHex(rig.hemiGround);
    hemisphere.intensity = rig.hemiIntensity;
  }

  function stats() {
    return Object.freeze({
      name: LIGHTING_RIG_NAMES[rigIndex],
      index: rigIndex,
    });
  }

  function setRig(index = 0) {
    rigIndex = wrapRigIndex(index);
    applyRig(RIGS[rigIndex]);
    return stats();
  }

  setRig(0);

  return Object.freeze({
    lights: Object.freeze({ key, hemisphere, fill, rim, group }),
    setRig,
    stats,
    get keyLight() {
      return key;
    },
  });
}
