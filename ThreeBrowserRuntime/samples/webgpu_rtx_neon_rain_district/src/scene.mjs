import * as THREE from "three/webgpu";
import { createDistrictAtmosphere } from "./atmosphere.mjs";
import { buildDistrictCity } from "./city.mjs";
import {
  createMetalMaterial,
  createWetPavementMaterial,
} from "./materials.mjs";
import { createTrafficSystem } from "./traffic.mjs";

function seededRandom(seed = 0x554d4252) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function createPedestrianContactShadowTexture() {
  const size = 48;
  const bytes = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; ++row) {
    const y = (row / (size - 1)) * 2 - 1;
    for (let column = 0; column < size; ++column) {
      const x = (column / (size - 1)) * 2 - 1;
      const radius = Math.hypot(x * 1.16, y);
      const falloff = Math.pow(THREE.MathUtils.clamp(1 - radius, 0, 1), 2.15);
      const value = Math.round(falloff * 255);
      const offset = (row * size + column) * 4;
      bytes[offset] = value;
      bytes[offset + 1] = value;
      bytes[offset + 2] = value;
      bytes[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    bytes,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "Soft generated pedestrian contact shadow";
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createPedestrianSystem(scene) {
  const PEDESTRIAN_COUNT = 11;
  const SIDEWALK_TOP = 0.14;
  const ROUTE_MIN_Z = -119;
  const ROUTE_MAX_Z = 15;
  const ROUTE_SPAN = ROUTE_MAX_Z - ROUTE_MIN_Z;
  const random = seededRandom();
  const root = new THREE.Group();
  root.name = "Pooled articulated rain pedestrians";
  root.userData.rtxIgnore = true;
  root.userData.pedestrianCount = PEDESTRIAN_COUNT;
  root.userData.sidewalkTop = SIDEWALK_TOP;
  scene.add(root);

  // Four invariant convoys keep people separated forever: everyone on one
  // route has the same speed and is exactly one route fraction apart. Adjacent
  // routes are more than two open-umbrella radii apart across the sidewalk.
  const routes = [
    { x: -8.05, direction: -1, speed: 0.68, count: 3, offset: 0.08 },
    { x: -10.68, direction: 1, speed: 0.76, count: 3, offset: 0.31 },
    { x: 8.05, direction: 1, speed: 0.71, count: 3, offset: 0.54 },
    { x: 10.68, direction: -1, speed: 0.79, count: 2, offset: 0.77 },
  ];
  if (routes.reduce((sum, route) => sum + route.count, 0) !== PEDESTRIAN_COUNT) {
    throw new Error("Pedestrian route population does not match the authored crowd size.");
  }

  const geometries = [
    new THREE.CylinderGeometry(1, 1, 1, 8, 1, false),
    new THREE.CylinderGeometry(0.58, 0.66, 1, 10, 1, false),
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.SphereGeometry(1, 8, 5),
    new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.ConeGeometry(1, 1, 7, 1, false),
    new THREE.PlaneGeometry(1, 1),
  ];
  const [
    limbGeometry,
    coatGeometry,
    boxGeometry,
    headGeometry,
    jointGeometry,
    hairGeometry,
    umbrellaGeometry,
    foldedUmbrellaGeometry,
    shadowGeometry,
  ] = geometries;

  const materials = new Set();
  function ownMaterial(material, name) {
    material.name = name;
    material.rtxReflectionMask = 0;
    material.userData.rtxIgnore = true;
    materials.add(material);
    return material;
  }
  function standardMaterial(hex, roughness, name, metalness = 0.02) {
    return ownMaterial(new THREE.MeshStandardNodeMaterial({
      color: hex,
      roughness,
      metalness,
    }), name);
  }

  const wetCharcoal = createWetPavementMaterial();
  const coatMaterials = [
    ownMaterial(wetCharcoal, "Wet charcoal pedestrian coat"),
    standardMaterial(0x172331, 0.54, "Rain-dark navy pedestrian coat", 0.05),
    standardMaterial(0x321d2a, 0.57, "Rain-dark burgundy pedestrian coat", 0.04),
    standardMaterial(0x283127, 0.61, "Rain-dark olive pedestrian coat", 0.03),
  ];
  const trouserMaterials = [
    standardMaterial(0x0b1015, 0.78, "Charcoal pedestrian trousers"),
    standardMaterial(0x20242a, 0.72, "Slate pedestrian trousers"),
  ];
  const skinMaterials = [
    standardMaterial(0x603b30, 0.78, "Deep skin tone"),
    standardMaterial(0x91634e, 0.76, "Medium skin tone"),
    standardMaterial(0xc08a69, 0.75, "Warm skin tone"),
  ];
  const hairMaterials = [
    standardMaterial(0x090a0c, 0.90, "Black pedestrian hair"),
    standardMaterial(0x2b1b17, 0.88, "Brown pedestrian hair"),
  ];
  const shoeMaterials = [
    standardMaterial(0x050709, 0.66, "Black rain shoes", 0.08),
    standardMaterial(0x271914, 0.64, "Brown rain shoes", 0.06),
  ];
  const bagMaterials = [
    standardMaterial(0x301c20, 0.69, "Oxblood shoulder bag", 0.03),
    standardMaterial(0x494033, 0.76, "Waxed canvas shoulder bag", 0.02),
  ];
  const umbrellaMaterials = [
    ownMaterial(createMetalMaterial(0x111820, 0.32, 0.18), "Graphite wet umbrella"),
    ownMaterial(createMetalMaterial(0x4b173c, 0.30, 0.20), "Plum wet umbrella"),
    ownMaterial(createMetalMaterial(0x123744, 0.31, 0.18), "Teal wet umbrella"),
  ];
  const umbrellaMetal = ownMaterial(
    createMetalMaterial(0x667078, 0.30, 0.88),
    "Umbrella shaft and handle",
  );

  const shadowTexture = createPedestrianContactShadowTexture();
  const shadowMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.30,
    alphaMap: shadowTexture,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  }), "Soft pedestrian pavement contact");
  shadowMaterial.polygonOffset = true;
  shadowMaterial.polygonOffsetFactor = -2;
  shadowMaterial.polygonOffsetUnits = -2;
  shadowMaterial.needsUpdate = true;

  // Parts reserve slots in a geometry/material bucket. Every frame only their
  // matrices change, turning hundreds of articulated pieces into a few dozen
  // shared draw calls with no per-frame allocation.
  const bucketLookup = new Map();
  const buckets = [];
  const canopyBuckets = new Set();
  const foldedBuckets = new Set();
  function reserve(geometry, material, label) {
    const key = `${geometry.uuid}:${material.uuid}`;
    let bucket = bucketLookup.get(key);
    if (!bucket) {
      bucket = { geometry, material, label, capacity: 0, cursor: 0, mesh: null };
      bucketLookup.set(key, bucket);
      buckets.push(bucket);
    }
    bucket.capacity += 1;
    return bucket;
  }

  const pedestrians = [];
  let pedestrianIndex = 0;
  for (let routeIndex = 0; routeIndex < routes.length; ++routeIndex) {
    const route = routes[routeIndex];
    for (let slot = 0; slot < route.count; ++slot) {
      const index = pedestrianIndex++;
      const hooded = index === 2 || index === 6 || index === 10;
      const hasUmbrella = !hooded;
      const holdSide = index % 2 === 0 ? 1 : -1;
      const coatMaterial = coatMaterials[index % coatMaterials.length];
      const trouserMaterial = trouserMaterials[(index + routeIndex) % trouserMaterials.length];
      const skinMaterial = skinMaterials[(index * 2 + routeIndex) % skinMaterials.length];
      const hairMaterial = hairMaterials[(index + 1) % hairMaterials.length];
      const shoeMaterial = shoeMaterials[index % shoeMaterials.length];
      const bagMaterial = bagMaterials[(index + routeIndex) % bagMaterials.length];
      const umbrellaMaterial = umbrellaMaterials[(index + routeIndex) % umbrellaMaterials.length];
      const hasBag = index % 3 !== 1;
      const anchor = new THREE.Object3D();
      anchor.name = `${hooded ? "Hooded" : "Umbrella"} articulated pedestrian ${String(index + 1).padStart(2, "0")}`;
      anchor.userData.rtxIgnore = true;
      anchor.userData.pedestrianIndex = index;
      anchor.userData.routeIndex = routeIndex;
      anchor.userData.direction = route.direction;
      anchor.userData.hasUmbrella = hasUmbrella;
      root.add(anchor);

      const parts = {
        torso: reserve(coatGeometry, coatMaterial, "Tapered coat torsos"),
        pelvis: reserve(boxGeometry, coatMaterial, "Coat pelvis blocks"),
        head: reserve(headGeometry, skinMaterial, "Pedestrian heads"),
        neck: reserve(jointGeometry, skinMaterial, "Pedestrian necks and hands"),
        hands: [
          reserve(jointGeometry, skinMaterial, "Pedestrian necks and hands"),
          reserve(jointGeometry, skinMaterial, "Pedestrian necks and hands"),
        ],
        upperArms: [
          reserve(limbGeometry, coatMaterial, "Jointed coat sleeves"),
          reserve(limbGeometry, coatMaterial, "Jointed coat sleeves"),
        ],
        lowerArms: [
          reserve(limbGeometry, coatMaterial, "Jointed coat sleeves"),
          reserve(limbGeometry, coatMaterial, "Jointed coat sleeves"),
        ],
        upperLegs: [
          reserve(limbGeometry, trouserMaterial, "Jointed trouser legs"),
          reserve(limbGeometry, trouserMaterial, "Jointed trouser legs"),
        ],
        lowerLegs: [
          reserve(limbGeometry, trouserMaterial, "Jointed trouser legs"),
          reserve(limbGeometry, trouserMaterial, "Jointed trouser legs"),
        ],
        shoes: [
          reserve(boxGeometry, shoeMaterial, "Planted rain shoes"),
          reserve(boxGeometry, shoeMaterial, "Planted rain shoes"),
        ],
        shadow: reserve(shadowGeometry, shadowMaterial, "Soft pedestrian contact shadows"),
      };
      if (hooded) {
        parts.hood = reserve(headGeometry, coatMaterial, "Raised coat hoods");
      } else {
        parts.hair = reserve(hairGeometry, hairMaterial, "Pedestrian hair caps");
      }
      if (hasBag) {
        parts.bag = reserve(boxGeometry, bagMaterial, "Pedestrian shoulder bags");
        parts.bagStrap = reserve(limbGeometry, bagMaterial, "Pedestrian bag straps");
      }
      if (hasUmbrella) {
        parts.canopy = reserve(umbrellaGeometry, umbrellaMaterial, "Open wet umbrella canopies");
        parts.folded = reserve(foldedUmbrellaGeometry, umbrellaMaterial, "Folded dry umbrella sleeves");
        parts.shaft = reserve(limbGeometry, umbrellaMetal, "Umbrella shafts");
        parts.handle = reserve(jointGeometry, umbrellaMetal, "Umbrella handles");
        canopyBuckets.add(parts.canopy);
        foldedBuckets.add(parts.folded);
      }

      pedestrians.push({
        index,
        route,
        routeIndex,
        offset: (route.offset + slot / route.count) * ROUTE_SPAN,
        phase: random() * Math.PI * 2,
        scale: 0.88 + random() * 0.14,
        width: 0.90 + random() * 0.18,
        hooded,
        hasUmbrella,
        holdSide,
        hasBag,
        bagSide: hasUmbrella ? -holdSide : (index % 2 ? 1 : -1),
        anchor,
        parts,
      });
    }
  }

  for (const bucket of buckets) {
    const mesh = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.capacity);
    mesh.name = `${bucket.label} pooled instances`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = bucket.material !== shadowMaterial;
    mesh.frustumCulled = false;
    mesh.renderOrder = bucket.material === shadowMaterial ? 2 : 0;
    mesh.userData.rtxIgnore = true;
    bucket.mesh = mesh;
    root.add(mesh);
  }

  const up = new THREE.Vector3(0, 1, 0);
  const routePosition = new THREE.Vector3();
  const routeQuaternion = new THREE.Quaternion();
  const routeScale = new THREE.Vector3();
  const routeMatrix = new THREE.Matrix4();
  const localPosition = new THREE.Vector3();
  const localQuaternion = new THREE.Quaternion();
  const localScale = new THREE.Vector3();
  const localMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const segmentStart = new THREE.Vector3();
  const segmentEnd = new THREE.Vector3();
  const segmentMidpoint = new THREE.Vector3();
  const segmentDirection = new THREE.Vector3();
  const umbrellaOffset = new THREE.Vector3();
  const umbrellaPosition = new THREE.Vector3();
  const umbrellaQuaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const identityQuaternion = new THREE.Quaternion();
  const shadowQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI * 0.5, 0, 0),
  );
  const hips = [new THREE.Vector3(), new THREE.Vector3()];
  const knees = [new THREE.Vector3(), new THREE.Vector3()];
  const ankles = [new THREE.Vector3(), new THREE.Vector3()];
  const shoulders = [new THREE.Vector3(), new THREE.Vector3()];
  const elbows = [new THREE.Vector3(), new THREE.Vector3()];
  const wrists = [new THREE.Vector3(), new THREE.Vector3()];
  const openGrip = new THREE.Vector3();
  const dryGrip = new THREE.Vector3();
  const umbrellaGrip = new THREE.Vector3();
  let rainTarget = 1;
  let rainBlend = 1;
  let disposed = false;

  function emit(bucket, position, quaternion, scale, parentMatrix = routeMatrix) {
    localMatrix.compose(position, quaternion, scale);
    instanceMatrix.multiplyMatrices(parentMatrix, localMatrix);
    bucket.mesh.setMatrixAt(bucket.cursor++, instanceMatrix);
  }

  function emitSegment(bucket, start, end, radius) {
    segmentDirection.subVectors(end, start);
    const length = Math.max(0.001, segmentDirection.length());
    segmentDirection.multiplyScalar(1 / length);
    segmentMidpoint.addVectors(start, end).multiplyScalar(0.5);
    localQuaternion.setFromUnitVectors(up, segmentDirection);
    localScale.set(radius, length, radius);
    emit(bucket, segmentMidpoint, localQuaternion, localScale);
  }

  function emitUmbrellaPart(bucket, offset, scale, baseQuaternion = identityQuaternion) {
    umbrellaPosition.copy(offset).applyQuaternion(umbrellaQuaternion).add(umbrellaGrip);
    localQuaternion.multiplyQuaternions(umbrellaQuaternion, baseQuaternion);
    emit(bucket, umbrellaPosition, localQuaternion, scale);
  }

  function update(time, delta) {
    if (disposed) return;
    const t = Number.isFinite(Number(time)) ? Number(time) : 0;
    const dt = THREE.MathUtils.clamp(Number(delta) || 0, 0, 0.05);
    rainBlend = THREE.MathUtils.damp(rainBlend, rainTarget, 7.5, dt);
    for (const bucket of buckets) bucket.cursor = 0;

    for (const pedestrian of pedestrians) {
      const { route, parts } = pedestrian;
      const distance = positiveModulo(pedestrian.offset + t * route.speed, ROUTE_SPAN);
      const z = route.direction > 0
        ? ROUTE_MIN_Z + distance
        : ROUTE_MAX_Z - distance;
      const x = route.x + Math.sin(t * 0.43 + pedestrian.phase) * 0.025;
      routePosition.set(x, SIDEWALK_TOP, z);
      routeQuaternion.setFromAxisAngle(up, route.direction > 0 ? 0 : Math.PI);
      routeScale.setScalar(pedestrian.scale);
      routeMatrix.compose(routePosition, routeQuaternion, routeScale);
      pedestrian.anchor.position.copy(routePosition);
      pedestrian.anchor.quaternion.copy(routeQuaternion);
      pedestrian.anchor.scale.setScalar(pedestrian.scale);

      const walkPhase = t * route.speed * 7.4 + pedestrian.phase;
      const stride = Math.sin(walkPhase);
      const legAngles = [stride * 0.30, -stride * 0.30];
      const kneeAngles = [
        Math.max(0, stride) * 0.34,
        Math.max(0, -stride) * 0.34,
      ];
      const upperLegLength = 0.42;
      const lowerLegLength = 0.40;
      const shoeHeight = 0.09;
      const hipY = upperLegLength + lowerLegLength + shoeHeight;
      const hipHalfWidth = 0.105 * pedestrian.width;
      let lowestSole = Infinity;
      for (let legIndex = 0; legIndex < 2; ++legIndex) {
        const side = legIndex === 0 ? -1 : 1;
        const upperAngle = legAngles[legIndex];
        const lowerAngle = upperAngle - kneeAngles[legIndex];
        hips[legIndex].set(side * hipHalfWidth, hipY, 0);
        knees[legIndex].set(
          side * hipHalfWidth,
          hipY - Math.cos(upperAngle) * upperLegLength,
          Math.sin(upperAngle) * upperLegLength,
        );
        ankles[legIndex].set(
          side * hipHalfWidth,
          knees[legIndex].y - Math.cos(lowerAngle) * lowerLegLength,
          knees[legIndex].z + Math.sin(lowerAngle) * lowerLegLength,
        );
        lowestSole = Math.min(lowestSole, ankles[legIndex].y - shoeHeight);
      }
      // Analytic grounding: lower the articulated body by exactly the current
      // lowest sole height. One shoe therefore remains planted on the 14 cm
      // sidewalk through every stride, and the correction supplies the hip bob.
      const bodyLift = -lowestSole;
      pedestrian.anchor.userData.shoeContactY = SIDEWALK_TOP;
      pedestrian.anchor.userData.bodyLift = bodyLift * pedestrian.scale;
      pedestrian.anchor.userData.umbrellaBlend = pedestrian.hasUmbrella ? rainBlend : 0;

      localPosition.set(0, 0.003, 0.08);
      localScale.set(pedestrian.hasUmbrella ? 0.64 : 0.48, pedestrian.hasUmbrella ? 0.92 : 0.72, 1);
      emit(parts.shadow, localPosition, shadowQuaternion, localScale);

      for (let legIndex = 0; legIndex < 2; ++legIndex) {
        hips[legIndex].y += bodyLift;
        knees[legIndex].y += bodyLift;
        ankles[legIndex].y += bodyLift;
        emitSegment(parts.upperLegs[legIndex], hips[legIndex], knees[legIndex], 0.058 * pedestrian.width);
        emitSegment(parts.lowerLegs[legIndex], knees[legIndex], ankles[legIndex], 0.052 * pedestrian.width);
        localPosition.set(
          ankles[legIndex].x,
          ankles[legIndex].y - shoeHeight * 0.5,
          ankles[legIndex].z + 0.045,
        );
        localScale.set(0.12 * pedestrian.width, shoeHeight, 0.255);
        emit(parts.shoes[legIndex], localPosition, identityQuaternion, localScale);
      }

      const pelvisY = hipY + bodyLift + 0.035;
      euler.set(0, Math.sin(walkPhase * 2) * 0.025, 0);
      localQuaternion.setFromEuler(euler);
      localPosition.set(0, pelvisY, 0);
      localScale.set(0.34 * pedestrian.width, 0.18, 0.235);
      emit(parts.pelvis, localPosition, localQuaternion, localScale);

      const torsoLength = pedestrian.hooded ? 0.59 : 0.56;
      const torsoBottom = hipY + bodyLift + 0.055;
      const torsoTop = torsoBottom + torsoLength;
      const torsoRoll = Math.sin(walkPhase) * 0.017;
      const torsoPitch = 0.022 + Math.cos(walkPhase * 2) * 0.009;
      euler.set(torsoPitch, 0, torsoRoll);
      localQuaternion.setFromEuler(euler);
      localPosition.set(0, torsoBottom + torsoLength * 0.5, 0);
      localScale.set(0.42 * pedestrian.width, torsoLength, 0.325 * pedestrian.width);
      emit(parts.torso, localPosition, localQuaternion, localScale);

      localPosition.set(0, torsoTop + 0.045, 0.006);
      localScale.set(0.072, 0.090, 0.068);
      emit(parts.neck, localPosition, identityQuaternion, localScale);
      const headY = torsoTop + 0.175;
      const headYaw = Math.sin(t * 0.31 + pedestrian.phase * 1.7) * 0.055;
      euler.set(-torsoPitch * 0.45, headYaw, -torsoRoll * 0.65);
      localQuaternion.setFromEuler(euler);
      if (pedestrian.hooded) {
        localPosition.set(0, headY + 0.006, -0.012);
        localScale.set(0.205, 0.220, 0.195);
        emit(parts.hood, localPosition, localQuaternion, localScale);
        localPosition.set(0, headY - 0.004, 0.062);
        localScale.set(0.137, 0.158, 0.128);
      } else {
        localPosition.set(0, headY, 0.008);
        localScale.set(0.158, 0.178, 0.148);
      }
      emit(parts.head, localPosition, localQuaternion, localScale);
      if (!pedestrian.hooded) {
        localPosition.set(0, headY + 0.012, 0.002);
        localScale.set(0.162, 0.180, 0.152);
        emit(parts.hair, localPosition, localQuaternion, localScale);
      }

      const shoulderY = torsoTop - 0.105;
      const shoulderHalfWidth = 0.235 * pedestrian.width;
      shoulders[0].set(-shoulderHalfWidth, shoulderY, 0);
      shoulders[1].set(shoulderHalfWidth, shoulderY, 0);
      openGrip.set(pedestrian.holdSide * 0.185, 1.28 + bodyLift, 0.12);
      dryGrip.set(pedestrian.holdSide * 0.285, 0.99 + bodyLift, 0.08);
      umbrellaGrip.lerpVectors(dryGrip, openGrip, rainBlend);

      for (let armIndex = 0; armIndex < 2; ++armIndex) {
        const armSide = armIndex === 0 ? -1 : 1;
        const holdingUmbrella = pedestrian.hasUmbrella && armSide === pedestrian.holdSide;
        if (holdingUmbrella) {
          elbows[armIndex].addVectors(shoulders[armIndex], umbrellaGrip).multiplyScalar(0.5);
          elbows[armIndex].x += armSide * 0.11;
          elbows[armIndex].y -= 0.045;
          elbows[armIndex].z -= 0.075;
          wrists[armIndex].copy(umbrellaGrip);
        } else {
          const armAngle = -legAngles[armIndex] * 0.82;
          const lowerArmAngle = armAngle + 0.12 + Math.max(0, -Math.cos(walkPhase + armIndex * Math.PI)) * 0.07;
          elbows[armIndex].set(
            shoulders[armIndex].x + armSide * 0.012,
            shoulderY - Math.cos(armAngle) * 0.29,
            Math.sin(armAngle) * 0.29,
          );
          wrists[armIndex].set(
            elbows[armIndex].x + armSide * 0.012,
            elbows[armIndex].y - Math.cos(lowerArmAngle) * 0.27,
            elbows[armIndex].z + Math.sin(lowerArmAngle) * 0.27,
          );
        }
        emitSegment(parts.upperArms[armIndex], shoulders[armIndex], elbows[armIndex], 0.052 * pedestrian.width);
        emitSegment(parts.lowerArms[armIndex], elbows[armIndex], wrists[armIndex], 0.045 * pedestrian.width);
        localPosition.copy(wrists[armIndex]);
        localScale.setScalar(0.055);
        emit(parts.hands[armIndex], localPosition, identityQuaternion, localScale);
      }

      if (pedestrian.hasBag) {
        const bagX = pedestrian.bagSide * 0.29 * pedestrian.width;
        const bagY = hipY + bodyLift + 0.23;
        localPosition.set(bagX, bagY, -0.075);
        euler.set(0.04, 0, pedestrian.bagSide * -0.08);
        localQuaternion.setFromEuler(euler);
        localScale.set(0.16, 0.29, 0.105);
        emit(parts.bag, localPosition, localQuaternion, localScale);
        segmentStart.set(pedestrian.bagSide * shoulderHalfWidth, shoulderY - 0.01, -0.01);
        segmentEnd.set(bagX, bagY + 0.10, -0.06);
        emitSegment(parts.bagStrap, segmentStart, segmentEnd, 0.012);
      }

      if (pedestrian.hasUmbrella) {
        const dryAmount = 1 - rainBlend;
        const swayX = Math.sin(t * 1.25 + pedestrian.phase) * 0.018 * rainBlend;
        const swayZ = Math.sin(t * 0.93 + pedestrian.phase * 1.4) * 0.026 * rainBlend
          + pedestrian.holdSide * 0.16 * dryAmount;
        euler.set(swayX, 0, swayZ);
        umbrellaQuaternion.setFromEuler(euler);
        const openScale = Math.max(0.001, rainBlend);
        const foldedScale = Math.max(0.001, dryAmount);
        umbrellaOffset.set(0, 0.69, 0);
        localScale.set(0.67 * openScale, 0.23 * openScale, 0.67 * openScale);
        emitUmbrellaPart(parts.canopy, umbrellaOffset, localScale);
        umbrellaOffset.set(0, 0.34, 0);
        localScale.set(0.014, 0.68, 0.014);
        emitUmbrellaPart(parts.shaft, umbrellaOffset, localScale);
        umbrellaOffset.set(0, 0.33, 0);
        localScale.set(0.075 * foldedScale, 0.62 * foldedScale, 0.075 * foldedScale);
        emitUmbrellaPart(parts.folded, umbrellaOffset, localScale);
        umbrellaOffset.set(0, -0.012, 0);
        localScale.setScalar(0.030);
        emitUmbrellaPart(parts.handle, umbrellaOffset, localScale);
      }
    }

    for (const bucket of buckets) {
      if (bucket.cursor !== bucket.capacity) {
        throw new Error(`Pedestrian instance bucket '${bucket.label}' was not completely updated.`);
      }
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const bucket of canopyBuckets) bucket.mesh.visible = rainBlend > 0.012;
    for (const bucket of foldedBuckets) bucket.mesh.visible = rainBlend < 0.988;
  }

  function setRainEnabled(enabled) {
    if (disposed) return;
    rainTarget = enabled ? 1 : 0;
  }

  // Populate every pooled matrix before the first render.
  update(0, 0);

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    shadowTexture.dispose();
    for (const material of materials) material.dispose();
    root.clear();
    pedestrians.length = 0;
    buckets.length = 0;
    bucketLookup.clear();
    canopyBuckets.clear();
    foldedBuckets.clear();
    geometries.length = 0;
    materials.clear();
  }

  return {
    root,
    update,
    setRainEnabled,
    dispose,
  };
}

export function buildNeonRainDistrict(scene, environment) {
  const city = buildDistrictCity(scene, environment);
  const traffic = createTrafficSystem(scene, environment);
  const atmosphere = createDistrictAtmosphere(scene);
  const pedestrians = createPedestrianSystem(scene);
  let rainEnabled = true;

  return {
    city,
    traffic,
    atmosphere,
    pedestrians,
    staticRoots: city.staticRoots,
    staticLights: city.staticLights,
    moon: city.moon,
    rtxInstanceGroup: traffic.rtxInstanceGroup,
    update(time, delta, camera) {
      city.update(time);
      traffic.update(time, delta);
      atmosphere.update(time, delta, camera);
      pedestrians.update(time, delta);
    },
    rayTracingInstanceUpdate() {
      return traffic.rayTracingInstanceUpdate();
    },
    setRainEnabled(enabled) {
      rainEnabled = Boolean(enabled);
      traffic.setRainEnabled(rainEnabled);
      atmosphere.setRainEnabled(rainEnabled);
      pedestrians.setRainEnabled(rainEnabled);
    },
    get rainEnabled() {
      return rainEnabled;
    },
    setReflectionQuality(highQuality) {
      city.setReflectionQuality(highQuality);
    },
    setNativeReflectionMode(enabled) {
      city.setNativeReflectionMode(enabled);
    },
    dispose() {
      city.dispose();
      traffic.dispose();
      atmosphere.dispose();
      pedestrians.dispose();
    },
  };
}
