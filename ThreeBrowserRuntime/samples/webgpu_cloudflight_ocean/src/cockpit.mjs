import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  cameraPosition,
  color,
  dot,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  vec3,
} from "three/tsl";

const UP = new THREE.Vector3(0, 1, 0);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function resolveOptions(cameraOrOptions, maybeScene) {
  if (cameraOrOptions?.isCamera) {
    return { camera: cameraOrOptions, scene: maybeScene ?? null };
  }
  return cameraOrOptions ?? {};
}

/**
 * Build a compact, entirely procedural light-aircraft cockpit.
 *
 * The returned root is parented to `camera`. If `scene` is supplied and the
 * camera has no parent, the camera is added to that scene so its children are
 * traversed by Three.js. All meshes are deliberately excluded from the static
 * RTX scene: the cockpit follows the aircraft every frame and remains authored
 * Three.js content.
 */
export function createCockpit(cameraOrOptions, maybeScene = null) {
  const options = resolveOptions(cameraOrOptions, maybeScene);
  const camera = options.camera;
  const scene = options.scene ?? null;
  if (!camera?.isCamera) throw new TypeError("createCockpit requires a Three.js camera.");
  if (scene?.isScene && !camera.parent) scene.add(camera);

  const geometries = new Set();
  const materials = new Set();
  const root = new THREE.Group();
  root.name = "Cloudflight first-person procedural cockpit";
  root.userData.rtxIgnore = true;
  // Cockpit units describe a compact light-aircraft cabin, while the camera's
  // near plane is only a few centimetres away. Scale and recess the assembly
  // so the canopy frames sit at the viewport edge and the weather remains the
  // subject of the frame instead of turning the dashboard into a mask.
  const cockpitScale = finite(options.scale, 0.39);
  const cockpitBase = new THREE.Vector3(0, -0.10, -0.27);
  root.scale.setScalar(cockpitScale);
  camera.add(root);

  const rememberGeometry = geometry => {
    geometries.add(geometry);
    return geometry;
  };
  const rememberMaterial = material => {
    material.rtxReflectionMask = 0;
    materials.add(material);
    return material;
  };
  const physical = (name, parameters) => {
    const material = new THREE.MeshPhysicalNodeMaterial(parameters);
    material.name = name;
    return rememberMaterial(material);
  };
  const basic = (name, parameters) => {
    const material = new THREE.MeshBasicNodeMaterial(parameters);
    material.name = name;
    material.toneMapped = parameters.toneMapped ?? true;
    return rememberMaterial(material);
  };

  const shellMaterial = physical("Cockpit charcoal composite", {
    color: 0x26343a,
    roughness: 0.62,
    metalness: 0.14,
    clearcoat: 0.24,
    clearcoatRoughness: 0.42,
    emissive: 0x050809,
    emissiveIntensity: 0.04,
  });
  const glareMaterial = physical("Cockpit glare shield", {
    color: 0x151d21,
    roughness: 0.88,
    metalness: 0.02,
    emissive: 0x030506,
    emissiveIntensity: 0.02,
  });
  const frameMaterial = physical("Canopy anodized frame", {
    color: 0x46555b,
    roughness: 0.49,
    metalness: 0.38,
    clearcoat: 0.10,
    emissive: 0x070b0d,
    emissiveIntensity: 0.05,
  });
  const headlinerMaterial = physical("Canopy interior headliner", {
    color: 0x080d0f,
    roughness: 0.94,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 1.0,
    emissive: 0x010304,
    emissiveIntensity: 0.05,
    side: THREE.DoubleSide,
  });
  const brushedMetal = physical("Cockpit brushed aluminium", {
    color: 0x718087,
    roughness: 0.30,
    metalness: 0.90,
  });
  const gaugeFaceMaterial = physical("Analogue instrument glass", {
    color: 0x05090b,
    roughness: 0.20,
    metalness: 0.05,
    clearcoat: 0.82,
    clearcoatRoughness: 0.10,
  });
  const gaugeRingMaterial = physical("Instrument bezels", {
    color: 0x28343a,
    roughness: 0.24,
    metalness: 0.84,
  });
  const tickMaterial = basic("Instrument phosphor ticks", {
    color: 0xb8e5dd,
    depthWrite: false,
    fog: false,
  });
  const needleMaterial = basic("Instrument amber needles", {
    color: 0xffb557,
    depthWrite: false,
    fog: false,
  });
  const coolNeedleMaterial = basic("Instrument cyan director", {
    color: 0x63dfd4,
    depthWrite: false,
    fog: false,
  });
  const cowlingMaterial = physical("Painted aircraft cowling", {
    color: 0x1f343d,
    roughness: 0.31,
    metalness: 0.46,
    clearcoat: 0.72,
    clearcoatRoughness: 0.16,
  });
  const propellerMaterial = basic("Motion-integrated propeller", {
    color: 0x9fc4cc,
    transparent: true,
    opacity: 0.032,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  propellerMaterial.blending = THREE.NormalBlending;

  // Local-space procedural finishes keep the cabin authored in JS/TSL while
  // giving large surfaces enough variation to read as real composite, padded
  // vinyl, and brushed alloy instead of flat coloured primitives.
  const compositeGrain = mx_noise_float(
    positionLocal.mul(vec3(4.2, 6.1, 4.6)),
  ).mul(0.5).add(0.5);
  const vinylGrain = mx_noise_float(
    positionLocal.mul(vec3(8.0, 6.0, 8.0)),
  ).mul(0.5).add(0.5);
  const alloyGrain = mx_noise_float(
    positionLocal.mul(vec3(2.4, 7.5, 2.4)),
  ).mul(0.5).add(0.5);
  shellMaterial.roughnessNode = mix(float(0.60), float(0.71), compositeGrain);
  glareMaterial.roughnessNode = mix(float(0.84), float(0.92), vinylGrain);
  frameMaterial.roughnessNode = mix(float(0.34), float(0.43), alloyGrain);
  brushedMetal.roughnessNode = mix(float(0.25), float(0.33), alloyGrain);

  const glassMaterial = basic("Laminated aviation windscreen", {
    color: 0xa9cbd2,
    transparent: true,
    opacity: 0.095,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  glassMaterial.blending = THREE.NormalBlending;
  glassMaterial.forceSinglePass = true;
  if (typeof options.glassReflectionNode === "function") {
    const incident = normalize(positionWorld.sub(cameraPosition));
    const reflectedRay = normalize(reflect(incident, normalWorld));
    const facing = dot(
      normalWorld,
      normalize(cameraPosition.sub(positionWorld)),
    ).abs().saturate();
    const fresnel = float(0.035).add(
      float(0.965).mul(pow(float(1).sub(facing), 5)),
    );
    const reflectedSky = options.glassReflectionNode(positionWorld, reflectedRay);
    const laminateGrain = mx_noise_float(
      positionLocal.mul(vec3(5.0, 19.0, 5.0)),
    ).mul(0.5).add(0.5);
    const laminateTint = mix(
      color(0x5f8791),
      color(0xa6c2c6),
      smoothstep(0.18, 0.86, laminateGrain),
    );
    glassMaterial.colorNode = reflectedSky.mul(0.64)
      .add(laminateTint.mul(0.14));
    glassMaterial.opacityNode = fresnel.mul(0.17)
      .add(mix(float(0.090), float(0.125), laminateGrain))
      .saturate();
  }
  function addMesh(parent, geometry, material, name, position, rotation = null, scale = null) {
    rememberGeometry(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.userData.rtxIgnore = true;
    mesh.castShadow = false;
    // Camera-mounted geometry must stay stable while the world shadow map and
    // temporal lighting update around it. Receiving those shadows creates hard
    // crawling edges across the canopy at flight speed.
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    if (position) mesh.position.fromArray(position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.fromArray(scale);
    parent.add(mesh);
    return mesh;
  }

  function addBox(parent, name, size, position, material, rotation = null) {
    const radius = Math.min(0.035, Math.min(...size) * 0.24);
    return addMesh(
      parent,
      new RoundedBoxGeometry(size[0], size[1], size[2], 4, radius),
      material,
      name,
      position,
      rotation,
    );
  }

  function addStrut(parent, name, start, end, radius, material) {
    const from = new THREE.Vector3().fromArray(start);
    const to = new THREE.Vector3().fromArray(end);
    const direction = to.clone().sub(from);
    const length = direction.length();
    const strut = addMesh(
      parent,
      new THREE.CylinderGeometry(radius, radius, length, 24, 1, false),
      material,
      name,
      from.add(to).multiplyScalar(0.5).toArray(),
    );
    strut.quaternion.setFromUnitVectors(UP, direction.normalize());
    return strut;
  }

  function addCurvedStrut(parent, name, points, radius, material) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(point => new THREE.Vector3().fromArray(point)),
      false,
      "centripetal",
    );
    return addMesh(
      parent,
      new THREE.TubeGeometry(curve, 36, radius, 12, false),
      material,
      name,
      null,
    );
  }

  function createOverheadLinerGeometry() {
    const acrossSegments = 24;
    const lengthSegments = 10;
    const positions = [];
    const uvs = [];
    const indices = [];

    // A continuous padded roof begins at the windscreen header and widens
    // toward the pilot. Its camera-side edge remains safely beyond the near
    // plane, avoiding the giant flat facets produced by the previous quad.
    for (let lengthIndex = 0; lengthIndex <= lengthSegments; ++lengthIndex) {
      const along = lengthIndex / lengthSegments;
      const shapedAlong = THREE.MathUtils.smoothstep(along, 0, 1);
      const z = THREE.MathUtils.lerp(-1.15, -0.10, shapedAlong);
      const halfWidth = THREE.MathUtils.lerp(0.69, 1.04, shapedAlong);
      const edgeY = THREE.MathUtils.lerp(0.76, 0.73, shapedAlong);
      const crownY = THREE.MathUtils.lerp(0.87, 1.04, shapedAlong);

      for (let acrossIndex = 0; acrossIndex <= acrossSegments; ++acrossIndex) {
        const across = acrossIndex / acrossSegments;
        const signed = across * 2 - 1;
        const arch = Math.pow(Math.max(0, Math.cos(signed * Math.PI * 0.5)), 0.72);
        positions.push(
          signed * halfWidth,
          THREE.MathUtils.lerp(edgeY, crownY, arch),
          z,
        );
        uvs.push(across, along);
      }
    }

    const stride = acrossSegments + 1;
    for (let lengthIndex = 0; lengthIndex < lengthSegments; ++lengthIndex) {
      for (let acrossIndex = 0; acrossIndex < acrossSegments; ++acrossIndex) {
        const a = lengthIndex * stride + acrossIndex;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  // The lower silhouette is broad enough to read as an aircraft interior but
  // leaves most of the viewport available for weather and ocean composition.
  addBox(root, "Low-profile glare shield", [1.92, 0.052, 0.18], [0, -0.235, -0.83], glareMaterial);
  addCurvedStrut(root, "Curved instrument coaming", [
    [-0.94, -0.255, -0.805],
    [-0.60, -0.205, -0.835],
    [ 0.00, -0.185, -0.850],
    [ 0.60, -0.205, -0.835],
    [ 0.94, -0.255, -0.805],
  ], 0.026, glareMaterial);
  addBox(root, "Main instrument panel", [1.86, 0.60, 0.075], [0, -0.54, -0.86], shellMaterial);
  addBox(root, "Lower avionics pedestal", [0.58, 0.27, 0.42], [0, -0.91, -0.62], shellMaterial);
  addBox(root, "Left side console", [0.30, 0.21, 0.90], [-1.00, -0.82, -0.28], shellMaterial, [0, 0, -0.035]);
  addBox(root, "Right side console", [0.30, 0.21, 0.90], [1.00, -0.82, -0.28], shellMaterial, [0, 0, 0.035]);
  addCurvedStrut(root, "Left curved cockpit rim", [
    [-1.03, -0.31, -0.93],
    [-1.10, -0.34, -0.44],
    [-1.11, -0.32,  0.18],
    [-1.04, -0.23,  0.82],
    [-0.78, -0.08,  1.42],
  ], 0.038, frameMaterial);
  addCurvedStrut(root, "Right curved cockpit rim", [
    [1.03, -0.31, -0.93],
    [1.10, -0.34, -0.44],
    [1.11, -0.32,  0.18],
    [1.04, -0.23,  0.82],
    [0.78, -0.08,  1.42],
  ], 0.038, frameMaterial);

  // Broad padded reveals sit behind the metal structure. Together with the
  // overhead liner and sidewalls they give the pilot a dark interior frame,
  // so even a featureless cloud deck is unmistakably seen from inside a cabin.
  addStrut(root, "Left padded windscreen reveal", [-1.055, -0.33, -0.91], [-0.685, 0.755, -1.17], 0.058, headlinerMaterial);
  addStrut(root, "Right padded windscreen reveal", [1.055, -0.33, -0.91], [0.685, 0.755, -1.17], 0.058, headlinerMaterial);
  addCurvedStrut(root, "Padded windscreen header", [
    [-0.69, 0.755, -1.17],
    [-0.35, 0.835, -1.22],
    [0, 0.865, -1.24],
    [0.35, 0.835, -1.22],
    [0.69, 0.755, -1.17],
  ], 0.050, headlinerMaterial);
  addCurvedStrut(root, "Padded windscreen lower seal", [
    [-1.04, -0.32, -0.91],
    [-0.52, -0.265, -0.90],
    [0, -0.245, -0.895],
    [0.52, -0.265, -0.90],
    [1.04, -0.32, -0.91],
  ], 0.036, headlinerMaterial);
  addBox(root, "Left upholstered cabin sidewall", [0.18, 0.54, 1.30], [-0.965, -0.50, 0.08], headlinerMaterial, [0, 0, -0.045]);
  addBox(root, "Right upholstered cabin sidewall", [0.18, 0.54, 1.30], [0.965, -0.50, 0.08], headlinerMaterial, [0, 0, 0.045]);

  // Canopy posts make the first-person camera legible even against featureless
  // white cloud. The weather compositor later reinforces the glass and wet
  // surface, while this authored geometry supplies correct depth and edges.
  addStrut(root, "Left windscreen post", [-1.03, -0.31, -0.93], [-0.66, 0.72, -1.20], 0.022, frameMaterial);
  addStrut(root, "Right windscreen post", [1.03, -0.31, -0.93], [0.66, 0.72, -1.20], 0.022, frameMaterial);
  addCurvedStrut(root, "Curved windscreen upper bow", [
    [-0.66, 0.72, -1.20],
    [-0.34, 0.79, -1.25],
    [0, 0.82, -1.27],
    [0.34, 0.79, -1.25],
    [0.66, 0.72, -1.20],
  ], 0.012, frameMaterial);
  addStrut(root, "Windscreen centre post", [0, -0.24, -0.89], [0, 0.81, -1.26], 0.007, frameMaterial);
  addCurvedStrut(root, "Rear canopy perimeter behind pilot", [
    [-0.76, -0.08, 1.48],
    [-0.70,  0.34, 1.48],
    [-0.48,  0.68, 1.48],
    [ 0.00,  0.78, 1.48],
    [ 0.48,  0.68, 1.48],
    [ 0.70,  0.34, 1.48],
    [ 0.76, -0.08, 1.48],
  ], 0.015, frameMaterial);

  // One continuous pane makes the camera feel enclosed and gives the analytic
  // atmosphere a real surface to reflect from. It deliberately stays in the
  // page-authored world pass; no native/cross-window overlay is involved.
  const windscreenCornerLocals = Object.freeze([
    new THREE.Vector3(-1.00, -0.30, -0.945),
    new THREE.Vector3( 1.00, -0.30, -0.945),
    new THREE.Vector3( 0.65,  0.715, -1.205),
    new THREE.Vector3(-0.65,  0.715, -1.205),
  ]);
  const windscreenGeometry = new THREE.BufferGeometry();
  windscreenGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    ...windscreenCornerLocals[0].toArray(),
    ...windscreenCornerLocals[1].toArray(),
    ...windscreenCornerLocals[2].toArray(),
    ...windscreenCornerLocals[3].toArray(),
  ], 3));
  windscreenGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  windscreenGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2));
  windscreenGeometry.computeVertexNormals();
  const windscreen = addMesh(
    root,
    windscreenGeometry,
    glassMaterial,
    "Reflective laminated windscreen",
    [0, 0, 0],
  );
  windscreen.renderOrder = 32;
  // const canopyShell = addMesh(
  //   root,
  //   createCanopyShellGeometry(),
  //   canopyGlassMaterial,
  //   "Full curved reflective canopy roof over pilot",
  //   [0, 0, 0],
  // );
  // canopyShell.renderOrder = 31;
  const overheadLiner = addMesh(
    root,
    createOverheadLinerGeometry(),
    headlinerMaterial,
    "Dark overhead canopy interior liner",
    [0, 0, 0],
  );
  overheadLiner.renderOrder = 18;

  // Local skylight entering through the canopy reveals controls without
  // flattening the ocean or weather lighting kilometres away.
  const cabinFill = new THREE.PointLight(0x95c5d7, 3.2, 3.2, 2.0);
  cabinFill.name = "Canopy-filtered cabin fill";
  cabinFill.position.set(0, 0.46, 0.26);
  cabinFill.castShadow = false;
  cabinFill.userData.rtxIgnore = true;
  root.add(cabinFill);
  const panelGlow = new THREE.PointLight(0xffa45f, 0.8, 2.4, 2.0);
  panelGlow.name = "Warm instrument-panel practical light";
  panelGlow.position.set(0, -0.34, -0.54);
  panelGlow.castShadow = false;
  panelGlow.userData.rtxIgnore = true;
  root.add(panelGlow);

  // A restrained cowling and translucent propeller supply aircraft scale and
  // engine state without becoming a large opaque obstruction in the view.
  addMesh(
    root,
    new THREE.SphereGeometry(0.62, 64, 32),
    cowlingMaterial,
    "Smooth engine cowling nose",
    [0, -0.70, -1.74],
    [0, 0, 0],
    [1.15, 0.38, 1.52],
  );
  const propeller = new THREE.Group();
  propeller.name = "Procedural propeller blur";
  propeller.position.set(0, -0.70, -2.67);
  addMesh(
    propeller,
    new THREE.CircleGeometry(0.94, 64),
    propellerMaterial,
    "Integrated propeller disc",
    [0, 0, 0],
  );
  addMesh(
    propeller,
    new THREE.RingGeometry(0.34, 0.92, 96),
    propellerMaterial,
    "Propeller tip blur ring",
    [0, 0, 0.002],
  );
  root.add(propeller);
  addMesh(
    root,
    new THREE.ConeGeometry(0.060, 0.18, 32, 1, false),
    cowlingMaterial,
    "Propeller spinner",
    [0, -0.70, -2.70],
    [-Math.PI * 0.5, 0, 0],
    [1.0, 1.0, 1.0],
  );

  const sharedTickGeometry = rememberGeometry(new THREE.PlaneGeometry(0.012, 0.032));
  const sharedHubGeometry = rememberGeometry(new THREE.CircleGeometry(0.024, 16));

  function createGauge(name, x, needle = needleMaterial, radius = 0.175, y = -0.56) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, -0.817);
    addMesh(group, new THREE.CircleGeometry(radius, 40), gaugeFaceMaterial, `${name} face`, [0, 0, 0]);
    addMesh(group, new THREE.RingGeometry(radius * 0.86, radius, 40), gaugeRingMaterial, `${name} bezel`, [0, 0, 0.004]);
    for (let index = 0; index < 12; ++index) {
      const angle = index / 12 * Math.PI * 2;
      const tick = addMesh(group, sharedTickGeometry, tickMaterial, `${name} tick ${index}`, [0, radius * 0.69, 0.009]);
      tick.scale.setScalar(radius / 0.175);
      tick.rotation.z = -angle;
      tick.position.set(Math.sin(angle) * radius * 0.69, Math.cos(angle) * radius * 0.69, 0.009);
    }
    const needleGeometry = new THREE.PlaneGeometry(0.014, radius * 0.70);
    needleGeometry.translate(0, radius * 0.31, 0);
    const needlePivot = new THREE.Group();
    needlePivot.name = `${name} needle`;
    addMesh(needlePivot, needleGeometry, needle, `${name} needle blade`, [0, 0, 0.014]);
    addMesh(needlePivot, sharedHubGeometry, gaugeRingMaterial, `${name} needle hub`, [0, 0, 0.017]);
    group.add(needlePivot);
    root.add(group);
    return { group, needle: needlePivot };
  }

  const airspeedGauge = createGauge("Airspeed indicator", -0.56);
  const altitudeGauge = createGauge("Altimeter", 0.56);

  // Dense upper instrument row follows classic light-aircraft ergonomics and
  // makes the cabin readable without relying on HTML/UI textures.
  createGauge("Manifold pressure", -0.74, coolNeedleMaterial, 0.072, -0.34);
  createGauge("Engine RPM", -0.38, needleMaterial, 0.072, -0.34);
  createGauge("Turn coordinator", 0, coolNeedleMaterial, 0.072, -0.34);
  createGauge("Fuel pressure", 0.38, needleMaterial, 0.072, -0.34);
  createGauge("Oil temperature", 0.74, needleMaterial, 0.072, -0.34);

  const attitudeGauge = new THREE.Group();
  attitudeGauge.name = "Artificial horizon";
  attitudeGauge.position.set(0, -0.57, -0.816);
  addMesh(attitudeGauge, new THREE.CircleGeometry(0.175, 40), gaugeFaceMaterial, "Attitude instrument face", [0, 0, 0]);
  addMesh(attitudeGauge, new THREE.RingGeometry(0.151, 0.175, 40), gaugeRingMaterial, "Attitude instrument bezel", [0, 0, 0.008]);
  const horizonDisk = new THREE.Group();
  horizonDisk.name = "Attitude horizon card";
  addMesh(horizonDisk, new THREE.CircleGeometry(0.142, 36, 0, Math.PI), basic("Attitude sky", {
    color: 0x315d73,
    depthWrite: false,
    fog: false,
  }), "Attitude sky half", [0, 0, 0.004]);
  addMesh(horizonDisk, new THREE.CircleGeometry(0.142, 36, Math.PI, Math.PI), basic("Attitude earth", {
    color: 0x6d4b2d,
    depthWrite: false,
    fog: false,
  }), "Attitude earth half", [0, 0, 0.004]);
  addBox(horizonDisk, "Attitude horizon line", [0.27, 0.010, 0.004], [0, 0, 0.012], coolNeedleMaterial);
  attitudeGauge.add(horizonDisk);
  addBox(attitudeGauge, "Fixed aircraft wing left", [0.092, 0.012, 0.006], [-0.070, -0.012, 0.021], needleMaterial);
  addBox(attitudeGauge, "Fixed aircraft wing right", [0.092, 0.012, 0.006], [0.070, -0.012, 0.021], needleMaterial);
  addBox(attitudeGauge, "Fixed aircraft centre", [0.012, 0.043, 0.006], [0, -0.006, 0.021], needleMaterial);
  root.add(attitudeGauge);

  // Small engine/flight annunciators introduce warm/cool practical light and
  // make changing weather state readable inside the cockpit.
  const annunciatorMaterials = [
    basic("Annunciator green", { color: 0x55e4aa, depthWrite: false, fog: false }),
    basic("Annunciator cyan", { color: 0x62cfe0, depthWrite: false, fog: false }),
    basic("Annunciator amber", { color: 0xffad45, depthWrite: false, fog: false }),
    basic("Annunciator red", { color: 0xff5448, depthWrite: false, fog: false }),
  ];
  const annunciators = [];
  for (let index = 0; index < 5; ++index) {
    const material = annunciatorMaterials[Math.min(index, 2)];
    const light = addBox(root, `Panel annunciator ${index}`, [0.080, 0.026, 0.010], [-0.20 + index * 0.10, -0.275, -0.800], material);
    annunciators.push(light);
  }

  const yoke = new THREE.Group();
  yoke.name = "Pilot control yoke";
  yoke.position.set(-0.24, -0.34, -0.48);
  addStrut(yoke, "Yoke column", [0, -0.29, -0.11], [0, -0.035, 0], 0.025, brushedMetal);
  addMesh(yoke, new THREE.TorusGeometry(0.155, 0.022, 10, 30), frameMaterial, "Yoke wheel", [0, 0, 0]);
  addBox(yoke, "Yoke centre bar", [0.26, 0.026, 0.028], [0, 0, 0], frameMaterial);
  addBox(yoke, "Yoke hub", [0.064, 0.064, 0.040], [0, 0, 0.018], brushedMetal);
  root.add(yoke);

  const throttle = new THREE.Group();
  throttle.name = "Throttle quadrant";
  throttle.position.set(0.80, -0.49, -0.30);
  addBox(throttle, "Throttle slot", [0.18, 0.045, 0.28], [0, -0.08, 0], glareMaterial);
  const throttleLever = new THREE.Group();
  throttleLever.name = "Throttle lever";
  throttleLever.position.set(0, -0.05, 0.02);
  addStrut(throttleLever, "Throttle shaft", [0, 0, 0], [0, 0.18, -0.12], 0.014, brushedMetal);
  addMesh(throttleLever, new THREE.SphereGeometry(0.040, 14, 8), frameMaterial, "Throttle grip", [0, 0.18, -0.12]);
  throttle.add(throttleLever);
  root.add(throttle);

  let elapsed = 0;
  let visible = true;

  function update(frame = {}) {
    const flight = frame.flight ?? frame.telemetry ?? frame;
    const weather = frame.weather && typeof frame.weather === "object" ? frame.weather : frame;
    const controls = frame.controls ?? flight.controls ?? flight;
    const delta = clamp(finite(frame.delta ?? frame.deltaSeconds, 1 / 60), 0, 0.1);
    elapsed = finite(frame.time ?? frame.elapsed ?? frame.elapsedSeconds, elapsed + delta);

    const rollRadians = finite(flight.rollRadians ?? flight.bankRadians ?? flight.roll ?? flight.bank, 0);
    const pitchRadians = finite(flight.pitchRadians ?? flight.pitch, 0);
    const aileron = clamp(finite(controls.aileron, rollRadians * 0.70), -1, 1);
    const elevator = clamp(finite(controls.elevator, pitchRadians * 0.85), -1, 1);
    const throttleAmount = clamp(finite(controls.throttle ?? flight.throttle, 0.68), 0, 1);
    const turbulence = clamp(finite(
      weather.turbulence ?? flight.turbulence ?? frame.cloudImmersion,
      0.10,
    ), 0, 1.5);
    const rain = clamp(finite(
      weather.rainIntensity ?? weather.precipitation ?? frame.rainIntensity ?? frame.rain,
      0,
    ), 0, 1);
    const airspeed = Math.max(0, finite(
      flight.airspeedMps ?? flight.airspeed ?? flight.speed
        ?? (Number.isFinite(Number(flight.speedKnots)) ? Number(flight.speedKnots) / 1.943844 : undefined),
      62,
    ));
    const altitude = Math.max(0, finite(flight.altitudeM ?? flight.altitude ?? flight.position?.y, 1200));
    const verticalSpeed = finite(flight.verticalSpeedMps ?? flight.verticalSpeed, 0);
    const rpm = Math.max(0, finite(flight.engineRpm ?? flight.rpm, 720 + throttleAmount * 2050));

    const vibration = turbulence * 0.0018 + throttleAmount * 0.00035;
    root.position.set(
      cockpitBase.x + Math.sin(elapsed * 37.1) * vibration,
      cockpitBase.y + Math.sin(elapsed * 31.7 + 1.2) * vibration * 0.72,
      cockpitBase.z,
    );
    root.rotation.z = Math.sin(elapsed * 23.3) * vibration * 0.42;

    yoke.rotation.z = THREE.MathUtils.lerp(yoke.rotation.z, aileron * 0.62, 1 - Math.exp(-delta * 11));
    yoke.position.z = THREE.MathUtils.lerp(yoke.position.z, -0.48 - elevator * 0.035, 1 - Math.exp(-delta * 9));
    throttleLever.rotation.x = THREE.MathUtils.lerp(
      throttleLever.rotation.x,
      THREE.MathUtils.lerp(-0.52, 0.42, throttleAmount),
      1 - Math.exp(-delta * 8),
    );

    const gaugeAngle = normalized => THREE.MathUtils.lerp(-Math.PI * 0.75, Math.PI * 0.75, clamp(normalized, 0, 1));
    airspeedGauge.needle.rotation.z = -gaugeAngle(airspeed / 120);
    altitudeGauge.needle.rotation.z = -gaugeAngle((altitude % 3000) / 3000);
    horizonDisk.rotation.z = -rollRadians;
    horizonDisk.position.y = clamp(-pitchRadians * 0.19, -0.055, 0.055);

    propeller.rotation.z = (elapsed * rpm * Math.PI / 30) % (Math.PI * 2);
    propellerMaterial.opacity = THREE.MathUtils.lerp(0.038, 0.016, clamp(rpm / 2800, 0, 1));

    annunciators[0].visible = throttleAmount > 0.04;
    annunciators[1].visible = Math.abs(verticalSpeed) < 7;
    annunciators[2].visible = rain > 0.08;
    annunciators[3].visible = rain > 0.68;
    annunciators[3].material = annunciatorMaterials[3];
    annunciators[4].visible = airspeed < 29 && altitude > 15;
    annunciators[4].material = annunciatorMaterials[3];
  }

  function setVisible(next) {
    visible = Boolean(next);
    root.visible = visible;
    return visible;
  }

  update(options.initialState ?? {});

  const projectedWindscreenCorners = windscreenCornerLocals.map(() => new THREE.Vector2());
  const projectedCornerWorld = new THREE.Vector3();
  function projectWindscreenCorners() {
    // NDC is converted to bottom-left screen UVs, matching the fullscreen
    // presentation quad. The compositor applies the render-target Y flip only
    // when it samples the wet-surface texture itself.
    root.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    for (let index = 0; index < windscreenCornerLocals.length; ++index) {
      projectedCornerWorld.copy(windscreenCornerLocals[index]);
      windscreen.localToWorld(projectedCornerWorld);
      projectedCornerWorld.project(camera);
      projectedWindscreenCorners[index].set(
        projectedCornerWorld.x * 0.5 + 0.5,
        projectedCornerWorld.y * 0.5 + 0.5,
      );
    }
    return projectedWindscreenCorners;
  }

  return {
    root,
    camera,
    windscreen,
    windscreenCornerLocals,
    projectWindscreenCorners,
    update,
    setVisible,
    toggleVisible() {
      return setVisible(!visible);
    },
    dispose() {
      root.removeFromParent();
      geometries.forEach(geometry => geometry.dispose?.());
      materials.forEach(material => material.dispose?.());
      geometries.clear();
      materials.clear();
    },
  };
}
