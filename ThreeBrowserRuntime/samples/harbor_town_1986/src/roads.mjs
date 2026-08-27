/** Flat Sakae-dori markings and Yokobori paving. Raised assets come from 2D orbits. */

export const ROAD_LANDMARKS = Object.freeze({
  "sakae-crosswalk": { x: 0, z: 2, yaw: Math.PI, pitch: -0.18 },
  "sakae-crosswalk-east": { x: 18, z: 2, yaw: Math.PI, pitch: -0.18 },
  "yokobori-alley": { x: 30, z: 20, yaw: 0.2, pitch: -0.12 },
  "quay-bollards": { x: 8, z: 84, yaw: 0, pitch: -0.08 },
});

const LANE_EDGE_Z = Object.freeze([-0.5, 4.5]);
const CROSSWALK_X = Object.freeze([0, 18]);
const PAINT_LIFT = 0.004;

function surfaceY(groundHeight, x, z) {
  const y = typeof groundHeight === "function" ? Number(groundHeight(x, z)) : 0;
  return Number.isFinite(y) ? y : 0;
}

function plant(mesh, name, x, y, z) {
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function addRoads(scene, { THREE, pavedSurfaceHeight, groundHeight, textures }) {
  const root = new THREE.Group();
  root.name = "roads";
  const roadSurfaceHeight = pavedSurfaceHeight || groundHeight;

  if (!textures?.whitePaint || !textures?.yellowPaint) {
    throw new Error("Road markings require Grok ground-tiles/road-white-paint.png and road-yellow-paint.png");
  }

  function paintMaterial(source, name, width, depth) {
    const map = source.clone();
    map.name = `${name} repeated texture`;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.repeat.set(Math.max(1, width / 2), Math.max(1, depth / 0.8));
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      name: `${name} Grok paint material`,
      map,
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  function flatMark(width, depth, source, name) {
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      paintMaterial(source, name, width, depth),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.castShadow = false;
    return mark;
  }

  for (const [i, z] of LANE_EDGE_Z.entries()) {
    const name = i === 0 ? "sakae-lane-edge-north" : "sakae-lane-edge-south";
    const edge = plant(
      flatMark(80, 0.08, textures.whitePaint, name),
      name,
      0,
      surfaceY(roadSurfaceHeight, 0, z) + PAINT_LIFT,
      z,
    );
    edge.castShadow = false;
    root.add(edge);
  }

  for (let x = -38; x <= 38; x += 4.4) {
    const name = `sakae-centre-dash-${x}`;
    const dash = plant(
      flatMark(1.85, 0.14, textures.yellowPaint, name),
      name,
      x,
      surfaceY(roadSurfaceHeight, x, 2) + PAINT_LIFT,
      2,
    );
    dash.castShadow = false;
    root.add(dash);
  }

  for (const originX of CROSSWALK_X) {
    for (let i = 0; i < 8; i++) {
      const x = originX + (i - 3.5) * 0.7;
      const z = 2;
      const name = `sakae-crosswalk-${originX}-stripe-${i}`;
      const stripe = plant(
        flatMark(0.4, 5.0, textures.whitePaint, name),
        name,
        x,
        surfaceY(roadSurfaceHeight, x, z) + PAINT_LIFT,
        z,
      );
      stripe.castShadow = false;
      root.add(stripe);
    }
  }

  scene.add(root);
  return root;
}
