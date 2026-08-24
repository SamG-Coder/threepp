import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createEnemyDirector } from "./ai/index.mjs";
import { createActorRegistry } from "./core/actor-registry.mjs";
import { createDevelopmentControlServer } from "./core/control-pipe.mjs";
import { createEncounterCoordinator } from "./core/encounters.mjs";
import { createEventBus } from "./core/events.mjs";
import { createGameSession } from "./core/game-session.mjs";
import { createInput } from "./core/input.mjs";
import { createRuntimeServices } from "./core/runtime-services.mjs";
import { attachWorldPhysics } from "./core/world-physics.mjs";
import { createNpcSystem } from "./npc/index.mjs";
import { createPlayer } from "./player/index.mjs";
import { createRpgHud } from "./ui/hud.mjs";
import { buildWorld } from "./world/index.mjs";

document.title = "Light Against the Dark — Medieval Valley RPG";

const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const MAX_INTERNAL_PIXELS = 5_400_000;
const TELEMETRY_INTERVAL = 10;

function pixelRatio(width, height) {
  const display = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  return Math.max(1, Math.min(2, display, Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height))));
}

function serializableSnapshot(session, actors, encounters, runtime, renderer, renderPipeline) {
  const game = session.snapshot({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  });
  return {
    ready: true,
    game,
    actors: actors.snapshot(),
    encounters: encounters.snapshot(),
    runtime: runtime.snapshot(),
    render: renderPipeline.status?.() ?? { label: "WEBGPU FALLBACK" },
  };
}

async function createRenderPipeline(renderer, scene, camera, world) {
  const fallback = {
    render() { return false; },
    resize() {},
    status() { return { label: "WEBGPU FALLBACK", features: {}, native: false }; },
    dispose() {},
  };
  try {
    const module = await import("./rtx/index.mjs");
    const pipeline = await module.createRpgRenderPipeline?.({ renderer, scene, camera, world });
    return pipeline ?? fallback;
  } catch (error) {
    console.warn(`[Medieval RPG] native RTX pipeline unavailable; full WebGPU fallback active: ${error?.message || error}`);
    return fallback;
  }
}

async function main() {
  if (!WebGPU.isAvailable()) throw new Error("Light Against the Dark requires the ThreeBrowser WebGPU runtime.");

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  renderer.setPixelRatio(pixelRatio(innerWidth, innerHeight));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x080b0e, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) throw new Error("WebGPURenderer did not initialize a WebGPU backend.");
  renderer.backend.device?.addEventListener?.("uncapturederror", event => {
    console.error("[Medieval RPG WebGPU]", event.error?.message || event.error || event);
  });

  const scene = new THREE.Scene();
  scene.name = "Keepfall medieval valley continuous RPG world";
  scene.background = new THREE.Color(0x111923);
  scene.fog = new THREE.FogExp2(0x263039, 0.0052);

  const camera = new THREE.PerspectiveCamera(52, innerWidth / Math.max(1, innerHeight), 0.08, 520);
  camera.position.set(0, 5, 184);

  const events = createEventBus();
  const input = createInput(renderer.domElement);
  const actors = createActorRegistry();
  const session = createGameSession({ events, input });
  const services = {
    events,
    input,
    camera,
    actors,
    combat: { queryTargets: request => actors.queryTargets(request) },
    ...session.services,
  };

  const world = buildWorld(scene, {
    ...services,
    progress: session.progression,
    onWorldEvent(type, payload) { events.emit(type, payload); },
  });
  attachWorldPhysics(world, scene);
  services.locations = world.locations;
  session.attachWorld(world);

  const runtime = createRuntimeServices({
    world,
    actors,
    events,
    inventory: session.inventory,
    economy: session.economy,
  });
  services.projectiles = runtime.projectiles;
  services.loot = runtime.loot;
  services.interaction = { interact: () => session.interact() };
  world.interactions = runtime.interactions;

  const spawnGround = world.sampleGround(0, 178).height;
  const player = createPlayer({
    THREE,
    world,
    services,
    input,
    events,
    camera,
    position: new THREE.Vector3(0, spawnGround, 178),
    loadout: { mainHand: "sword", offHand: "shield", armor: "leather", owned: ["sword", "shield"] },
  });
  services.player = player;
  runtime.setPlayer(player);

  const npcs = createNpcSystem({ THREE, world, services, input, events });
  const enemies = createEnemyDirector({ THREE, world, services, events });
  services.npcs = npcs;
  services.enemies = enemies;
  session.attachActors({ player, npcs, enemies });
  player.cycleWeapon = () => session.cycleWeapon();
  const encounters = createEncounterCoordinator({
    world,
    enemies,
    quests: session.quests,
    progression: session.progression,
    events,
  });

  const hud = createRpgHud({ renderer });
  const renderPipeline = await createRenderPipeline(renderer, scene, camera, world);
  session.setRtxStatus(renderPipeline.status?.());

  const hazards = [];
  world.queueBossHazard = descriptor => hazards.push({ ...descriptor, remaining: Math.max(0, Number(descriptor.delay) || 0) });
  world.activateBossHazard = descriptor => events.emit("world:boss-hazard", descriptor);
  world.breakProps = descriptor => events.emit("world:props-hit", descriptor);

  let elapsed = 0;
  let accumulator = 0;
  let lastFrame = Number(globalThis.performance?.now?.() ?? Date.now()) * 0.001;
  let telemetryAt = TELEMETRY_INTERVAL;
  let disposed = false;
  let lastSnapshot = session.snapshot();
  let controlServer = null;

  function updateHazards(delta) {
    for (let index = hazards.length - 1; index >= 0; --index) {
      const hazard = hazards[index];
      hazard.remaining -= delta;
      if (hazard.remaining > 0) continue;
      hazards.splice(index, 1);
      const origin = hazard.source?.root?.position;
      if (!origin || !player.alive) continue;
      const radius = Math.max(1, Number(hazard.radius) || 4);
      if (origin.distanceToSquared(player.root.position) <= radius * radius) {
        player.receiveHit({
          source: hazard.source,
          damage: 24 + Number(hazard.source?.phase ?? 1) * 8,
          poiseDamage: 55,
          direction: player.root.position.clone().sub(origin).setY(0).normalize(),
          kind: hazard.kind,
        });
      }
    }
  }

  function fixedUpdate(delta) {
    const systemsDelta = session.paused ? 0 : delta;
    lastSnapshot = session.update(systemsDelta, elapsed, {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
    if (!session.paused) {
      player.update(delta);
      enemies.update(delta);
      npcs.update(delta);
      encounters.update(delta, player, session.time.snapshot(), session.weather.current());
      runtime.update(delta);
      updateHazards(delta);
    }
    world.update(elapsed, systemsDelta, {
      camera,
      playerPosition: player.root.position,
      timeOfDay: session.time.timeOfDay,
      weather: session.weather.current(),
    });
  }

  function renderFrame(frameDelta) {
    renderer.info.reset();
    hud.update(lastSnapshot);
    const hudTexture = renderPipeline.status?.().configured ? hud.renderToTexture() : null;
    const rendered = renderPipeline.render?.(scene, camera, {
      elapsed,
      delta: frameDelta,
      player,
      snapshot: lastSnapshot,
      hudTexture,
    });
    if (!rendered) {
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.render(scene, camera);
      hud.render();
    }
  }

  function animate(timestampMs) {
    if (disposed) return;
    const now = Number(timestampMs) * 0.001;
    const frameDelta = Math.min(MAX_FRAME_DELTA, Math.max(0, now - lastFrame));
    lastFrame = now;
    accumulator = Math.min(MAX_FRAME_DELTA * 2, accumulator + frameDelta);
    while (accumulator >= FIXED_STEP) {
      elapsed += FIXED_STEP;
      fixedUpdate(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    renderFrame(frameDelta);
    input.endFrame();

    if (elapsed >= telemetryAt) {
      telemetryAt += TELEMETRY_INTERVAL;
      const status = renderPipeline.status?.() ?? {};
      session.setRtxStatus(status);
      console.log(
        `[Medieval RPG] t=${elapsed.toFixed(1)}s actors=${actors.values().length}` +
        ` enemies=${enemies.active().length} calls=${renderer.info.render.calls}` +
        ` triangles=${renderer.info.render.triangles} path=${status.label ?? "WEBGPU FALLBACK"}`,
      );
    }
  }

  function onResize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setPixelRatio(pixelRatio(width, height));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    hud.resize(width, height);
    renderPipeline.resize?.(width, height);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    globalThis.removeEventListener("resize", onResize);
    await controlServer?.close?.();
    renderPipeline.dispose?.();
    hud.dispose();
    session.dispose();
    enemies.dispose();
    npcs.dispose();
    player.dispose();
    runtime.dispose();
    input.dispose();
    actors.clear();
    world.dispose();
    renderer.dispose();
  }

  async function control(request = {}) {
    switch (request.op) {
      case "ping": return { pong: true, elapsed };
      case "snapshot": return serializableSnapshot(session, actors, encounters, runtime, renderer, renderPipeline);
      case "action": input.injectAction(request.action); return { action: request.action };
      case "key": input.injectKey(request.code, request.down !== false); return { code: request.code, down: request.down !== false };
      case "interact": return { target: session.interact()?.id ?? null };
      case "weather": return session.setWeather(request.mode, request.transitionMinutes ?? 0);
      case "time": return session.setTime(request.hour);
      case "teleport": {
        const x = THREE.MathUtils.clamp(Number(request.x) || 0, world.bounds.minX + 2, world.bounds.maxX - 2);
        const z = THREE.MathUtils.clamp(Number(request.z) || 0, world.bounds.minZ + 2, world.bounds.maxZ - 2);
        player.root.position.set(x, world.sampleGround(x, z).height, z);
        player.controller.velocity.set(0, 0, 0);
        return { position: player.root.position.toArray() };
      }
      case "face": {
        const target = request.target ? actors.get(String(request.target)) : null;
        const x = Number(target?.root?.position?.x ?? request.x);
        const z = Number(target?.root?.position?.z ?? request.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          throw new TypeError("face requires a valid target actor or x/z position");
        }
        const dx = x - player.root.position.x;
        const dz = z - player.root.position.z;
        const yaw = Math.atan2(-dx, -dz);
        player.root.rotation.y = yaw;
        player.yaw = yaw;
        player.controller.cameraYaw = yaw;
        return { target: target?.id ?? null, yaw };
      }
      case "spawn": {
        const x = Number(request.x ?? player.root.position.x + 7);
        const z = Number(request.z ?? player.root.position.z - 7);
        const enemy = encounters.spawn(request.archetype ?? "wolf", x, z, "control", Number(request.level) || 1);
        return enemy?.snapshot?.() ?? null;
      }
      case "damage": {
        const target = actors.get(String(request.target ?? ""));
        if (!target?.receiveHit) throw new RangeError(`Actor cannot receive damage: ${request.target}`);
        const amount = THREE.MathUtils.clamp(Number(request.amount) || 1, 0, 10_000);
        const result = target.receiveHit({
          source: player,
          damage: amount,
          poiseDamage: Number(request.poiseDamage ?? amount),
          direction: target.root.position.clone().sub(player.root.position).setY(0).normalize(),
          kind: "development-control",
        });
        return {
          id: target.id,
          accepted: Boolean(result?.accepted),
          damage: Number(result?.damage ?? 0),
          health: Number(target.stats?.health ?? 0),
          maxHealth: Number(target.stats?.maxHealth ?? 0),
          phase: Number(target.phase ?? 0),
          alive: target.alive !== false,
        };
      }
      case "advance": {
        const steps = THREE.MathUtils.clamp(Math.trunc(Number(request.steps) || 1), 1, 36_000);
        for (let index = 0; index < steps; ++index) { elapsed += FIXED_STEP; fixedUpdate(FIXED_STEP); }
        return { elapsed, steps };
      }
      case "quest": return session.quests.notify(request.event);
      case "save": return session.persistentSnapshot();
      case "restore": session.restore(request.snapshot); return { restored: true };
      case "dispose":
        // Closing the named-pipe server from inside its own request handler
        // would wait on the current socket forever. Defer teardown until after
        // this response has been written and the client can disconnect.
        setTimeout(() => { void dispose(); }, 0);
        return { disposing: true };
      default: throw new RangeError(`Unknown control operation: ${request.op}`);
    }
  }

  controlServer = await createDevelopmentControlServer(control);
  globalThis.__MEDIEVAL_RPG__ = Object.freeze({
    snapshot: () => serializableSnapshot(session, actors, encounters, runtime, renderer, renderPipeline),
    control,
  });
  globalThis.addEventListener("resize", onResize);
  globalThis.addEventListener("beforeunload", () => { void dispose(); }, { once: true });
  onResize();
  fixedUpdate(0);
  renderer.setAnimationLoop(animate);
  console.log(
    `[Medieval RPG] READY · ${Object.keys(world.landmarks).length} landmarks` +
    ` · ${world.interactables.length} interactions · ${npcs.npcs.length} scheduled NPCs` +
    ` · ${renderPipeline.status?.().label ?? "WEBGPU FALLBACK"}`,
  );
}

main().catch(error => {
  console.error("[Medieval RPG] Fatal startup error", error?.stack || error);
  throw error;
});
