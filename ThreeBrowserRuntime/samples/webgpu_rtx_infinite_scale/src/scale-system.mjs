import * as THREE from "three/webgpu";
import { buildForgeDomain } from "./forge-domain.mjs";
import { buildMicrostructureDomain, buildSurfaceDomain } from "./mesoscale-domains.mjs";
import {
  buildAtomicDomain,
  buildBccCrystalDomain,
  buildEnergyDomain,
  buildNucleusDomain,
} from "./atomic-domains.mjs";
import { SETTLEMENT_SECONDS } from "./scale-model.mjs";

const FULL_FRAME_DISTANCE_SCALE = 0.24;
const FULL_FRAME_FOV_SCALE = 0.86;
const INCOMING_PROJECTION_SCALE = 0.65;
const INCOMING_DEPTH_FRACTION = 0.002;

const fallbackGateways = Object.freeze({
  crystal: [0, 0, -0.65],
  atomic: [0, 0, -0.45],
  nucleus: [0, 0, -0.52],
  energy: [0, 0.05, -6.45],
});

function cloneCameraFrame(domain, t) {
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.002, 100);
  const target = new THREE.Vector3();
  domain.sampleCamera(t, camera, target);
  return {
    position: camera.position.clone(),
    target: target.clone(),
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    distance: Math.max(1e-5, camera.position.distanceTo(target)),
    direction: target.clone().sub(camera.position).normalize(),
  };
}

function smooth01(value) {
  const x = Math.min(1, Math.max(0, Number(value) || 0));
  return Math.min(1, Math.max(0, x * x * x * (x * (x * 6 - 15) + 10)));
}

function createGatewayLayers(domain, index, kind) {
  const colors = [0xff8c42, 0xc7d6dc, 0x82b9c7, 0x6fbaff, 0x74d9ff, 0xff7fb3, 0xc58aff];
  const color = colors[(index + (kind === "entry" ? 6 : 0)) % colors.length];
  const group = new THREE.Group();
  group.name = `${domain.id} ${kind} nested scale membranes`;
  group.position.copy(kind === "entry" ? domain.entryFrame.target : domain.gatewayPosition);
  group.visible = false;

  const pointPositions = [];
  const pointCount = 720;
  for (let point = 0; point < pointCount; ++point) {
    const shell = 0.26 + (point % 9) * 0.085;
    const z = 1 - 2 * ((point * 0.61803398875) % 1);
    const angle = point * 2.3999632297;
    const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
    const ripple = 1 + Math.sin(point * 0.73) * 0.08;
    pointPositions.push(
      Math.cos(angle) * horizontal * shell * ripple,
      z * shell * ripple,
      Math.sin(angle) * horizontal * shell * ripple,
    );
  }
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
  const pointMaterial = new THREE.PointsNodeMaterial({
    color,
    size: 0.022,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  pointMaterial.toneMapped = false;
  const points = new THREE.Points(pointGeometry, pointMaterial);
  points.frustumCulled = false;
  points.userData.rtxIgnore = true;
  group.add(points);

  const membranes = [];
  const membraneBaseRotations = [];
  for (let layer = 0; layer < 4; ++layer) {
    const material = new THREE.MeshBasicNodeMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    material.toneMapped = false;
    const membrane = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.28 + layer * 0.18, layer % 2),
      material,
    );
    membrane.rotation.set(layer * 0.37, layer * 0.61, layer * 0.23);
    membraneBaseRotations.push(membrane.rotation.clone());
    membrane.userData.rtxIgnore = true;
    membranes.push(membrane);
    group.add(membrane);
  }
  domain.root.add(group);

  return {
    group,
    update(strength, time) {
      const amount = Math.min(1, Math.max(0, strength));
      group.visible = amount > 0.002;
      if (!group.visible) return;
      pointMaterial.opacity = amount * 0.54;
      points.rotation.y = time * (kind === "entry" ? -0.24 : 0.21);
      points.rotation.x = Math.sin(time * 0.37 + index) * 0.18;
      membranes.forEach((membrane, layer) => {
        membrane.material.opacity = amount * (0.11 + layer * 0.035);
        const base = membraneBaseRotations[layer];
        membrane.rotation.x = base.x + time * 0.09 * (layer + 1);
        membrane.rotation.y = base.y + time * 0.126 * (5 - layer);
        membrane.rotation.z = base.z + Math.sin(time * 0.31 + layer) * 0.08;
      });
      const pulse = 0.74 + amount * 0.58 + Math.sin(time * 2.2 + index) * 0.035;
      group.scale.setScalar(pulse);
    },
  };
}

function setStreamState(domain, state) {
  domain.root.userData.streamState = state;
  domain.root.visible = state === "current" || state === "transition" || state === "retiring";
}

export function createScaleSystem(scene, { onRebase = null } = {}) {
  const domains = [
    buildForgeDomain(),
    buildSurfaceDomain(),
    buildMicrostructureDomain(),
    buildBccCrystalDomain(),
    buildAtomicDomain(),
    buildNucleusDomain(),
    buildEnergyDomain(),
  ];

  const byId = new Map(domains.map(domain => [domain.id, domain]));
  for (let index = 0; index < domains.length; ++index) {
    const domain = domains[index];
    // Local domain coordinates stay close to zero. The immutable native TLAS
    // keeps those normalized worlds in isolated atlas cells; at a rebase both
    // camera and visible root move to the matching cell. This avoids rebuilding
    // the AS without pretending that the cell offset has physical scale.
    domain.zoneOffset = new THREE.Vector3(index * 240, 0, 0);
    domain.entryFrame = cloneCameraFrame(domain, 0);
    domain.exitFrame = cloneCameraFrame(domain, 1);
    domain.gatewayPosition = domain.gatewayPosition?.clone?.() ??
      new THREE.Vector3(...(fallbackGateways[domain.id] ?? domain.exitFrame.target.toArray()));
    domain.entryGatewayLayers = createGatewayLayers(domain, index, "entry");
    domain.exitGatewayLayers = createGatewayLayers(domain, index, "exit");
    domain.root.visible = false;
    domain.root.position.copy(domain.zoneOffset);
    domain.root.matrixAutoUpdate = true;
    scene.add(domain.root);
  }

  // Parent visibility normally removes a domain's lights from Three's
  // LightsNode, creating a different shader program for every handoff pair.
  // Keep the authored lights as scene children instead. Their finite ranges
  // and atlas positions still isolate dormant domains, while the stable light
  // object set lets every material reuse one already-warmed pipeline layout.
  const persistentLights = [];
  const persistentTargets = new Set();
  for (let domainIndex = 0; domainIndex < domains.length; ++domainIndex) {
    const domain = domains[domainIndex];
    domain.root.updateWorldMatrix(true, true);
    const rootInverse = domain.root.matrixWorld.clone().invert();
    const lights = [];
    domain.root.traverse(object => {
      if (object.isLight) lights.push(object);
    });
    domain.persistentLights = [];
    for (const light of lights) {
      light.updateWorldMatrix(true, false);
      const entry = {
        domain,
        domainIndex,
        light,
        localMatrix: new THREE.Matrix4().multiplyMatrices(rootInverse, light.matrixWorld),
        worldMatrix: new THREE.Matrix4(),
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(),
        target: null,
        targetLocalMatrix: null,
        targetWorldMatrix: new THREE.Matrix4(),
        targetPosition: new THREE.Vector3(),
        targetQuaternion: new THREE.Quaternion(),
        targetScale: new THREE.Vector3(),
      };
      if (light.isHemisphereLight && domain.id !== "forge") light.intensity *= 0.33;
      if (light.target?.parent) {
        light.target.updateWorldMatrix(true, false);
        entry.target = light.target;
        entry.targetLocalMatrix = new THREE.Matrix4().multiplyMatrices(
          rootInverse,
          light.target.matrixWorld,
        );
        persistentTargets.add(light.target);
      }
      scene.add(light);
      if (entry.target) scene.add(entry.target);
      domain.persistentLights.push(entry);
      persistentLights.push(entry);
    }
  }

  function syncPersistentLights() {
    for (const entry of persistentLights) {
      entry.domain.root.updateWorldMatrix(true, false);
      entry.worldMatrix.multiplyMatrices(entry.domain.root.matrixWorld, entry.localMatrix);
      entry.worldMatrix.decompose(entry.position, entry.quaternion, entry.scale);
      entry.light.position.copy(entry.position);
      entry.light.quaternion.copy(entry.quaternion);
      entry.light.scale.copy(entry.scale);
      entry.light.updateMatrixWorld(true);
      if (entry.target) {
        entry.targetWorldMatrix.multiplyMatrices(
          entry.domain.root.matrixWorld,
          entry.targetLocalMatrix,
        );
        entry.targetWorldMatrix.decompose(
          entry.targetPosition,
          entry.targetQuaternion,
          entry.targetScale,
        );
        entry.target.position.copy(entry.targetPosition);
        entry.target.quaternion.copy(entry.targetQuaternion);
        entry.target.scale.copy(entry.targetScale);
        entry.target.updateMatrixWorld(true);
      }
    }
  }
  syncPersistentLights();

  let currentIndex = -1;
  let rebaseCount = 0;
  let lastHandoff = null;
  let activeHandoff = null;
  let overlapDirection = 0;
  const exitDirection = new THREE.Vector3();
  const transitionRotation = new THREE.Quaternion();
  const scaledEntryTarget = new THREE.Vector3();
  const finalEntryTarget = new THREE.Vector3();
  const finalHandoffPosition = new THREE.Vector3();
  const currentGateway = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const identityQuaternion = new THREE.Quaternion();
  const handoffPosition = new THREE.Vector3();
  const handoffQuaternion = new THREE.Quaternion();
  const streaming = domains.map(domain => ({
    id: domain.id,
    state: "dormant",
    visible: false,
  }));
  const updateResult = {
    current: null,
    next: null,
    neighborIndex: 0,
    transitionAmount: 0,
    incomingAmount: 0,
    settling: false,
    rebaseCount: 0,
    scaleInvariant: true,
    streaming,
  };

  function resetTransform(domain) {
    domain.root.position.copy(domain.zoneOffset);
    domain.root.quaternion.identity();
    domain.root.scale.setScalar(1);
  }

  function applyStreaming(index, neighborIndex, transition, retiringIndex = -1) {
    const previousIndex = (index + domains.length - 1) % domains.length;
    const nextIndex = (index + 1) % domains.length;
    domains.forEach((domain, candidate) => {
      if (candidate === index) setStreamState(domain, "current");
      else if (candidate === neighborIndex && transition > 0.002) setStreamState(domain, "transition");
      else if (candidate === retiringIndex) setStreamState(domain, "retiring");
      else if (candidate === nextIndex) setStreamState(domain, "warm-next");
      else if (candidate === previousIndex) setStreamState(domain, "warm-previous");
      else setStreamState(domain, "dormant");
    });
  }

  function restoreRetiringLights(handoff) {
    for (const entry of handoff?.retiringLights ?? []) entry.light.intensity = entry.intensity;
  }

  function update(sample, time, delta, camera, target) {
    const index = sample.index;
    const current = domains[index];
    const travelDirection = sample.direction < 0 ? -1 : 1;

    if (index !== currentIndex) {
      const previous = currentIndex;
      overlapDirection = 0;
      restoreRetiringLights(activeHandoff);
      currentIndex = index;
      rebaseCount += 1;
      if (lastHandoff?.index === index) {
        const retiringLights = (domains[lastHandoff.sourceIndex]?.persistentLights ?? [])
          .map(entry => ({ light: entry.light, intensity: entry.light.intensity }));
        activeHandoff = {
          index,
          position: lastHandoff.position.clone(),
          quaternion: lastHandoff.quaternion.clone(),
          scale: lastHandoff.scale,
          fov: lastHandoff.fov,
          direction: lastHandoff.direction,
          sourceIndex: lastHandoff.sourceIndex,
          retiringLights,
        };
      } else {
        activeHandoff = null;
      }
      for (const domain of domains) resetTransform(domain);
      onRebase?.({
        previousIndex: previous,
        index,
        previous: previous >= 0 ? domains[previous] : null,
        current,
        rebaseCount,
        cycle: sample.cycle,
      });
    }

    // Once a neighbor has begun resolving, keep that overlap alive while its
    // amount unwinds even if the user reverses. This avoids replacing one
    // neighbor with the opposite neighbor in a single frame.
    if (overlapDirection !== 0) {
      const activeAmount = overlapDirection > 0 ? sample.transition : sample.reverseTransition;
      if (activeAmount <= 0.002) overlapDirection = 0;
    }
    if (overlapDirection === 0) {
      const travelAmount = travelDirection > 0 ? sample.transition : sample.reverseTransition;
      if (travelAmount > 0.002) overlapDirection = travelDirection;
    }
    const direction = overlapDirection || travelDirection;
    const transitionAmount = overlapDirection > 0
      ? sample.transition
      : overlapDirection < 0
        ? sample.reverseTransition
        : 0;
    const neighborIndex = (index + direction + domains.length) % domains.length;
    const next = domains[neighborIndex];

    const incomingProgress = activeHandoff?.direction < 0
      ? (1 - sample.localLinear) * sample.domain.seconds / SETTLEMENT_SECONDS
      : sample.localLinear * sample.domain.seconds / SETTLEMENT_SECONDS;
    const incomingAmount = activeHandoff
      ? 1 - smooth01(incomingProgress)
      : 0;
    const retiringIndex = activeHandoff && incomingAmount > 0.001
      ? activeHandoff.sourceIndex
      : -1;
    applyStreaming(index, neighborIndex, transitionAmount, retiringIndex);
    resetTransform(current);
    current.sampleCamera(sample.localT, camera, target);
    current.update(time, delta, sample.localT);
    // Domain animation may rotate its artistic root. The scale system owns the
    // root similarity transform, so apply it after domain-local animation.
    resetTransform(current);

    if (activeHandoff && incomingAmount > 0.001) {
      const resolved = 1 - incomingAmount;
      handoffPosition.lerpVectors(activeHandoff.position, current.zoneOffset, resolved);
      handoffQuaternion.slerpQuaternions(activeHandoff.quaternion, identityQuaternion, resolved);
      const handoffScale = Math.exp(
        THREE.MathUtils.lerp(Math.log(Math.max(1e-5, activeHandoff.scale)), 0, resolved),
      );
      current.root.position.copy(handoffPosition);
      current.root.quaternion.copy(handoffQuaternion);
      current.root.scale.setScalar(handoffScale);
      camera.position.multiplyScalar(handoffScale).applyQuaternion(handoffQuaternion).add(handoffPosition);
      target.multiplyScalar(handoffScale).applyQuaternion(handoffQuaternion).add(handoffPosition);
      camera.fov = THREE.MathUtils.lerp(activeHandoff.fov, camera.fov, resolved);
    } else {
      restoreRetiringLights(activeHandoff);
      activeHandoff = null;
      camera.position.add(current.zoneOffset);
      target.add(current.zoneOffset);
    }

    // Finish each shot with a true close focus. By the time the handoff begins,
    // the scratch, grain, atom, or energy feature fills the frame; the viewer
    // never sees the next normalized world floating as a card in the old one.
    const focusAmount = direction > 0 ? sample.focus : sample.reverseFocus;
    const currentAnchor = direction > 0 ? current.gatewayPosition : current.entryFrame.target;
    currentGateway.copy(currentAnchor)
      .multiplyScalar(current.root.scale.x)
      .applyQuaternion(current.root.quaternion)
      .add(current.root.position);
    if (focusAmount > 0) {
      const distanceScale = THREE.MathUtils.lerp(1, FULL_FRAME_DISTANCE_SCALE, focusAmount);
      camera.position.lerp(currentGateway, 1 - distanceScale);
      target.lerp(currentGateway, focusAmount);
      camera.fov *= THREE.MathUtils.lerp(1, FULL_FRAME_FOV_SCALE, focusAmount);
      camera.near = Math.max(1e-5, camera.near * distanceScale);
    }
    const entryLayerStrength = Math.max(
      activeHandoff?.direction > 0 ? incomingAmount : 0,
      direction < 0 ? transitionAmount : 0,
    );
    const exitLayerStrength = Math.max(
      activeHandoff?.direction < 0 ? incomingAmount : 0,
      direction > 0 ? transitionAmount : 0,
    );
    current.entryGatewayLayers.update(entryLayerStrength, time);
    current.exitGatewayLayers.update(exitLayerStrength, time);
    if (retiringIndex >= 0) {
      const retiring = domains[retiringIndex];
      retiring.update(time, delta, activeHandoff.direction > 0 ? 1 : 0);
      resetTransform(retiring);
      for (const entry of activeHandoff.retiringLights) {
        entry.light.intensity = entry.intensity * incomingAmount;
      }
      if (activeHandoff.direction > 0) retiring.exitGatewayLayers.update(incomingAmount, time);
      else retiring.entryGatewayLayers.update(incomingAmount, time);
    }

    // Keep the next representation alive only during the fixed final handoff.
    // It is real geometry, not a full-screen dissolve: its entry camera frame is
    // spatially aligned to the outgoing gateway and grows until the coordinate
    // system can be rebased without changing its projected size.
    if (transitionAmount > 0.002) {
      resetTransform(next);
      next.update(time, delta, direction > 0 ? 0 : 1);
      resetTransform(next);
      const neighborFrame = direction > 0 ? next.entryFrame : next.exitFrame;
      exitDirection.copy(currentGateway).sub(camera.position).normalize();
      transitionRotation.setFromUnitVectors(neighborFrame.direction, exitDirection);
      next.root.quaternion.copy(transitionRotation);

      // Match actual camera distance. The incoming similarity transform keeps
      // this exact configuration after the boundary, then eases its FOV and
      // coordinate scale back to the new domain's canonical entry frame.
      const finalScale = THREE.MathUtils.clamp(
        camera.position.distanceTo(currentGateway) / neighborFrame.distance,
        0.02,
        24,
      );
      const emerge = finalScale * THREE.MathUtils.lerp(
        INCOMING_PROJECTION_SCALE,
        1,
        smooth01(transitionAmount),
      );
      next.root.scale.setScalar(emerge);

      scaledEntryTarget.copy(neighborFrame.target).multiplyScalar(emerge);
      scaledEntryTarget.applyQuaternion(transitionRotation);
      next.root.position.copy(currentGateway).sub(scaledEntryTarget);

      // Begin behind the focal surface and resolve forward through it. This
      // avoids pasting an opaque miniature panel over the outgoing scene.
      const depthOffset = camera.position.distanceTo(currentGateway) *
        INCOMING_DEPTH_FRACTION * (1 - smooth01(transitionAmount));
      next.root.position.addScaledVector(exitDirection, depthOffset);
      next.entryGatewayLayers.update(direction > 0 ? transitionAmount : 0, time);
      next.exitGatewayLayers.update(direction < 0 ? transitionAmount : 0, time);
      lastHandoff = {
        index: neighborIndex,
        position: finalHandoffPosition.copy(currentGateway).sub(
          finalEntryTarget.copy(neighborFrame.target)
            .multiplyScalar(finalScale)
            .applyQuaternion(transitionRotation),
        ).clone(),
        quaternion: next.root.quaternion.clone(),
        scale: finalScale,
        fov: camera.fov,
        direction,
        sourceIndex: index,
      };
    }

    // Root scale is uniform by contract. Keep this assertion cheap and visible
    // to the diagnostic HUD rather than throwing in a live cinematic frame.
    tmpScale.copy(current.root.scale);
    const scaleInvariant = Math.max(
      Math.abs(tmpScale.x - tmpScale.y),
      Math.abs(tmpScale.y - tmpScale.z),
    ) < 1e-7;

    syncPersistentLights();

    for (let candidate = 0; candidate < domains.length; ++candidate) {
      streaming[candidate].state = domains[candidate].root.userData.streamState;
      streaming[candidate].visible = domains[candidate].root.visible;
    }
    updateResult.current = current;
    updateResult.next = next;
    updateResult.neighborIndex = neighborIndex;
    updateResult.transitionAmount = transitionAmount;
    updateResult.incomingAmount = incomingAmount;
    updateResult.settling = incomingAmount > 0.001;
    updateResult.rebaseCount = rebaseCount;
    updateResult.scaleInvariant = scaleInvariant;
    return updateResult;
  }

  function dispose() {
    for (const entry of persistentLights) scene.remove(entry.light);
    for (const target of persistentTargets) scene.remove(target);
    for (const domain of domains) {
      scene.remove(domain.root);
      domain.dispose?.();
    }
  }

  return {
    domains,
    byId,
    persistentLights,
    update,
    dispose,
    get currentIndex() { return currentIndex; },
    get rebaseCount() { return rebaseCount; },
  };
}
