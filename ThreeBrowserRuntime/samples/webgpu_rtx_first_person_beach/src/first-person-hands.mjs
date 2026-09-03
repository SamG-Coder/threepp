import * as THREE from "three/webgpu";

const up = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const midpoint = new THREE.Vector3();

function capsuleBetween(parent, start, end, radius, material, name) {
  direction.copy(end).sub(start);
  const length = direction.length();
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 6, 10);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(midpoint.copy(start).add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(up, direction.normalize());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.rtxIgnore = true;
  parent.add(mesh);
  return mesh;
}

function addGripHand(group, { gripY, side, armEnd }) {
  const glove = group.userData.materials.glove;
  const sleeve = group.userData.materials.sleeve;
  const cuff = group.userData.materials.cuff;
  const shaftFront = 0.036;

  const wrist = new THREE.Vector3(side * 0.052, gripY - 0.055, 0.095);
  capsuleBetween(group, armEnd, wrist, 0.052, sleeve, `${side < 0 ? "Left" : "Right"} forearm`);
  capsuleBetween(
    group,
    new THREE.Vector3(side * 0.052, gripY - 0.09, 0.092),
    new THREE.Vector3(side * 0.052, gripY - 0.035, 0.082),
    0.058,
    cuff,
    `${side < 0 ? "Left" : "Right"} glove cuff`,
  );

  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), glove);
  palm.name = `${side < 0 ? "Left" : "Right"} gripping palm`;
  palm.position.set(side * 0.044, gripY, 0.038);
  palm.scale.set(0.052, 0.072, 0.045);
  palm.rotation.z = side * 0.18;
  palm.frustumCulled = false;
  palm.userData.rtxIgnore = true;
  group.add(palm);

  for (let index = 0; index < 4; index += 1) {
    const y = gripY - 0.035 + index * 0.022;
    capsuleBetween(
      group,
      new THREE.Vector3(side * 0.065, y, shaftFront),
      new THREE.Vector3(-side * 0.025, y + side * 0.002, shaftFront + 0.012),
      0.0115,
      glove,
      `${side < 0 ? "Left" : "Right"} gripping finger ${index + 1}`,
    );
  }

  capsuleBetween(
    group,
    new THREE.Vector3(side * 0.075, gripY + 0.025, 0.057),
    new THREE.Vector3(side * 0.012, gripY - 0.017, 0.067),
    0.014,
    glove,
    `${side < 0 ? "Left" : "Right"} thumb`,
  );
}

export function createFirstPersonShovelHands() {
  const group = new THREE.Group();
  group.name = "First-person two-hand shovel grip";
  group.visible = false;
  group.userData.rtxIgnore = true;
  group.userData.materials = {
    glove: new THREE.MeshStandardMaterial({
      name: "Weathered black work gloves",
      color: 0x171b1c,
      roughness: 0.82,
      metalness: 0,
    }),
    cuff: new THREE.MeshStandardMaterial({
      name: "Reinforced glove cuffs",
      color: 0x252b2b,
      roughness: 0.88,
      metalness: 0,
    }),
    sleeve: new THREE.MeshStandardMaterial({
      name: "Rolled field sleeves",
      color: 0x33443d,
      roughness: 0.96,
      metalness: 0,
    }),
  };

  addGripHand(group, {
    gripY: 0.81,
    side: 1,
    armEnd: new THREE.Vector3(0.48, 0.35, 0.32),
  });
  addGripHand(group, {
    gripY: 1.08,
    side: -1,
    armEnd: new THREE.Vector3(-0.48, 0.64, 0.29),
  });
  return group;
}
