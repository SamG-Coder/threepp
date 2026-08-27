import graph from "./nav-graph.json" with { type: "json" };
import { clampWalk, walkSurfaceHeight as mapSurfaceHeight } from "./map.mjs";
import { isStuck, seededRng, shouldUpdate } from "./ambient-util.mjs";

/** Every consecutive pair, including wraparound, is an authored nav edge. */
export const AMBIENT_ROUTES = Object.freeze([
  Object.freeze(["route16", "tobacco", "soba", "produce", "pharmacy", "arcade", "records", "arcade", "pharmacy", "produce", "soba", "tobacco"]),
  Object.freeze(["flower", "sakae", "pharmacy", "arcade", "records", "east-crosswalk", "barber", "sakae"]),
  Object.freeze(["harbor-gate", "harbor", "warehouse", "quay", "seawall", "quay", "harbor"]),
  Object.freeze(["hill", "house", "stairs"]),
  Object.freeze(["sakae", "harbor-gate", "harbor", "quay", "harbor", "harbor-gate"]),
  Object.freeze(["records", "east-crosswalk", "yokobori", "east-crosswalk", "barber", "sakae", "pharmacy", "arcade"]),
]);

export const AMBIENT_CIVILIAN_ASSETS = Object.freeze([
  "civilian-hiro",
  "civilian-mika",
  "civilian-dock-worker",
  "civilian-shopper",
  "civilian-student",
  "civilian-shopkeeper",
]);

function nodeMap() {
  const map = new Map();
  for (const node of graph.nodes) map.set(node.id, node);
  return map;
}

function instantiate(factory, assetId, pose, label) {
  if (typeof factory !== "function") return null;
  const object = factory(assetId, pose, label);
  return object && typeof object === "object" ? object : null;
}

export function createAmbientLife({ scene, surfaceHeight, createAssetInstance, resolvePosition }) {
  const height = surfaceHeight || mapSurfaceHeight;
  const nodes = nodeMap();
  const rng = seededRng(19861129);
  const agents = [];

  function place(agent, bob = 0) {
    const pad = clampWalk(agent.x, agent.z);
    agent.x = pad.x;
    agent.z = pad.z;
    agent.object.position.set(agent.x, height(agent.x, agent.z) + bob, agent.z);
    agent.object.rotation.y = agent.yaw;
  }

  for (const [index, assetId] of AMBIENT_CIVILIAN_ASSETS.entries()) {
    const route = AMBIENT_ROUTES[index % AMBIENT_ROUTES.length];
    const start = nodes.get(route[0]);
    if (!start) continue;
    const x = start.x + (rng() - 0.5) * 0.7;
    const z = start.z + (rng() - 0.5) * 0.32;
    const object = instantiate(
      createAssetInstance,
      assetId,
      { x, z, yaw: 0 },
      `ambient ${assetId} (2D orbit)`,
    );
    if (!object) continue;
    scene.add(object);
    const agent = {
      object,
      route,
      index: 1,
      x,
      z,
      yaw: 0,
      pause: rng() * 1.5,
      stuck: 0,
      lastX: x,
      lastZ: z,
      seed: index,
      time: rng() * Math.PI * 2,
    };
    place(agent);
    agents.push(agent);
  }

  const standing = [];
  const pairSpecs = [
    { asset: "civilian-shopper", x: -8.4, z: -8.65, yaw: 1.4 },
    { asset: "civilian-shopkeeper", x: -7.4, z: -8.65, yaw: -1.6 },
    { asset: "civilian-mika", x: 20.5, z: 10.8, yaw: 0.3 },
    { asset: "civilian-hiro", x: 21.3, z: 11.2, yaw: 3.4 },
  ];
  for (const [index, pose] of pairSpecs.entries()) {
    const object = instantiate(
      createAssetInstance,
      pose.asset,
      pose,
      `standing ${pose.asset} ${index} (2D orbit)`,
    );
    if (!object) continue;
    scene.add(object);
    standing.push({ object, baseY: height(pose.x, pose.z), phase: index * 1.7 });
  }

  let elapsed = 0;
  return {
    update(dt, camera) {
      const step = Number(dt);
      if (!Number.isFinite(step) || step <= 0) return;
      elapsed += step;
      const cx = camera?.position?.x ?? 0;
      const cz = camera?.position?.z ?? 0;
      for (const agent of agents) {
        const dist = Math.hypot(agent.x - cx, agent.z - cz);
        if (!shouldUpdate(dist)) continue;
        agent.time += step;
        if (agent.pause > 0) {
          agent.pause -= step;
          continue;
        }
        const target = nodes.get(agent.route[agent.index]);
        if (!target) {
          agent.index = 0;
          continue;
        }
        const dx = target.x - agent.x;
        const dz = target.z - agent.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.55) {
          agent.index = (agent.index + 1) % agent.route.length;
          agent.pause = 0.7 + (agent.seed % 3) * 0.45;
          place(agent);
          continue;
        }
        const speed = 1.08 + (agent.seed % 3) * 0.07;
        const targetX = agent.x + (dx / len) * speed * step;
        const targetZ = agent.z + (dz / len) * speed * step;
        const resolved = typeof resolvePosition === "function"
          ? resolvePosition(agent.x, agent.z, targetX, targetZ)
          : { x: targetX, z: targetZ };
        const movedX = resolved.x - agent.x;
        const movedZ = resolved.z - agent.z;
        agent.x = resolved.x;
        agent.z = resolved.z;
        if (Math.hypot(movedX, movedZ) > 1e-5) agent.yaw = Math.atan2(movedX, movedZ);
        place(agent, 0.014 * Math.abs(Math.sin(agent.time * 6.4)));
        if (isStuck({ x: agent.lastX, z: agent.lastZ }, agent, step)) {
          agent.stuck += step;
          if (agent.stuck > 10) {
            agent.index = (agent.index + 1) % agent.route.length;
            const next = nodes.get(agent.route[agent.index]);
            agent.x = next.x;
            agent.z = next.z;
            agent.stuck = 0;
            place(agent);
          }
        } else {
          agent.stuck = 0;
        }
        agent.lastX = agent.x;
        agent.lastZ = agent.z;
      }

      for (const person of standing) {
        person.object.position.y = person.baseY + 0.006 * Math.sin(person.phase + elapsed * 1.2);
      }
    },
    counts: { walkers: agents.length, standing: standing.length },
  };
}
