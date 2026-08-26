import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  MINIMAP_PLACE_ICON_MASKS,
  MINIMAP_PLACE_ICON_PALETTE,
  MINIMAP_RASTER_SCALE,
  MINIMAP_RASTER_SIZE,
  PHONE_MAP_VIEWPORT,
  projectWorldToMinimap,
} from "../src/ui/hud.mjs";

const pipePath = process.argv[2];
const hudScreenshotPath = path.resolve(
  process.argv[3] ?? path.join(process.cwd(), "artifacts", "gta-neon-place-icons-map.png"),
);
const phoneScreenshotPath = path.resolve(
  process.argv[4] ?? path.join(process.cwd(), "artifacts", "gta-neon-phone-map.png"),
);
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-map-places-qa.mjs <pipe> [hud-map.png] [phone-map.png]");
}

const EXPECTED_BUSINESSES = Object.freeze([
  "common_ground_cafe",
  "harbour_lantern",
  "mina_market_kitchen",
  "southline_diner",
]);
const EXPECTED_LIFE_ACTIVITIES = Object.freeze([
  "pulse_garage_apprentice",
  "harbour-skills-house",
  "common_ground_shift",
  "mina_market_shift",
  "pulse_parcels",
  "city_lens",
  "pulse_park_run",
  "neighbourhood_hands",
  "pulse_line",
  "pulse_roadside",
  "harbour_court",
]);
const EXPECTED_WORLD_DESTINATIONS = Object.freeze([
  ["residentialInterior", "home"],
  ["pulseGarageInterior", "work"],
  ["communityHub", "work"],
  ["commonGroundCafe", "work"],
  ["minaMarketKitchen", "work"],
  ["pulseTransit", "transit"],
]);
const EXPECTED_ICON_CATEGORIES = Object.freeze([
  "business", "home", "work", "activity", "transit", "story", "waypoint",
]);
const EXPECTED_MAP_PLACES = Object.freeze([
  "southline_studio_3b",
  "pulse_garage",
  "harbour-skills-house",
  "common_ground_cafe",
  "mina_market_kitchen",
  "pulse-street-exchange",
  "harbour_lantern",
  "southline_diner",
  "pulse_parcels",
  "city_lens",
  "pulse_park_run",
  "neighbourhood_hands",
  "pulse_roadside",
  "harbour_court",
  "ashwind_breach",
  "ashwind_ruins",
]);

// Keep the native test pinned to authored readable silhouettes rather than
// accepting single-pixel category dots as place icons.
assert.equal(MINIMAP_RASTER_SCALE, 2);
assert.equal(MINIMAP_RASTER_SIZE, 392);
assert.deepEqual(Object.keys(MINIMAP_PLACE_ICON_MASKS).sort(), [...EXPECTED_ICON_CATEGORIES].sort());
for (const category of EXPECTED_ICON_CATEGORIES) {
  const mask = MINIMAP_PLACE_ICON_MASKS[category];
  assert.equal(mask.length, 9, `${category} icon must retain its nine-row silhouette`);
  assert.ok(mask.every(row => row.length === 11 && /^[01]+$/.test(row)),
    `${category} icon mask is malformed`);
  assert.ok(mask.reduce((count, row) => count + [...row].filter(cell => cell === "1").length, 0) >= 20,
    `${category} icon no longer has a legible filled silhouette`);
  assert.equal(MINIMAP_PLACE_ICON_PALETTE[category].length, 4,
    `${category} icon has no complete RGBA palette entry`);
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = new Map();
    this.sequence = 0;
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "native minimap control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native minimap request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() {
    this.socket.end();
  }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function connectWithRetry(target, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const socket = net.createConnection(target);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }
  throw lastError ?? new Error("native minimap pipe did not become ready");
}

function stateFrom(response) {
  return response?.state ?? response;
}

function firstChoiceId(state) {
  return state?.choice?.options?.[0]?.id ?? null;
}

function positionOf(value) {
  const source = value?.entrance?.exterior ?? value?.entrance?.threshold ?? value?.entrance
    ?? value?.hubPosition ?? value?.hub ?? value?.position ?? value ?? null;
  if (Array.isArray(source) && source.length >= 3 && source.every(Number.isFinite)) return source;
  if (source && [source.x, source.y ?? 0, source.z].every(Number.isFinite)) {
    return [source.x, source.y ?? 0, source.z];
  }
  return null;
}

async function clearBlockingNarrative(client) {
  let state = await client.request("snapshot");
  if (state.paused) {
    await client.request("action", { action: "pause" });
    state = stateFrom(await client.request("advance", { steps: 2 }));
  }
  for (let guard = 0; guard < 128; ++guard) {
    if (state.nightRoute?.controlsLocked) {
      const option = firstChoiceId(state.nightRoute);
      await client.request("nightRoute", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else if (state.chapterTwo?.active || state.chapterTwo?.choice) {
      const option = firstChoiceId(state.chapterTwo);
      await client.request("chapterTwo", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else if (state.story?.active || state.story?.choice) {
      const option = firstChoiceId(state.story);
      await client.request("story", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else {
      assert.equal(state.narrative?.controlsLocked, false,
        "an authored narrative retained controls during native minimap QA");
      return state;
    }
    state = await client.request("snapshot");
  }
  throw new Error("blocking narrative did not settle within 128 authored transitions");
}

function verifyPlaceSources(state) {
  assert.equal(state.world?.minimapRadius, 104);
  assert.ok(state.world?.roadSpacing > 0);
  for (const [key, category] of EXPECTED_WORLD_DESTINATIONS) {
    const destination = state.world?.[key];
    assert.ok(destination, `native world snapshot omitted ${key}`);
    assert.ok(positionOf(destination), `${key} exposes no finite ${category} icon anchor`);
  }

  const businesses = state.neighbourhood?.businesses ?? [];
  assert.deepEqual(businesses.map(value => value.id).sort(), [...EXPECTED_BUSINESSES].sort(),
    "the minimap business source registry is incomplete");
  assert.ok(businesses.every(value => positionOf(value)),
    "a business exposes no finite map position");
  assert.ok(businesses.some(value => value.open === true));
  assert.ok(businesses.some(value => value.open === false));

  const activities = state.lifeActivities ?? [];
  assert.deepEqual(activities.map(value => value.id), EXPECTED_LIFE_ACTIVITIES,
    "the minimap life-activity source registry changed or is incomplete");
  const standalone = activities.slice(4);
  assert.ok(standalone.every(value => positionOf(value)),
    "a standalone life activity exposes no finite map hub");
  assert.deepEqual(new Set(standalone.map(value => value.kind)),
    new Set(["courier", "photography", "fitness", "volunteer", "transit", "mechanic", "basketball"]));

  const storyTarget = state.chapterTwoMission?.targetPosition ?? state.mission?.targetPosition
    ?? state.mission?.startPosition ?? state.mission?.dropoffPosition;
  assert.ok(positionOf(storyTarget), "the active authored story exposes no map target");

  const navigation = state.mapNavigation ?? state.phone?.mapNavigation;
  assert.ok(navigation, "native snapshot omitted the shared map-navigation model");
  assert.deepEqual(navigation.places.map(value => value.id), EXPECTED_MAP_PLACES,
    "the canonical phone/HUD place directory is incomplete or out of order");
  assert.ok(navigation.places.every(value => positionOf(value)),
    "a canonical navigation destination exposes no finite position");
  assert.deepEqual(
    Object.fromEntries(["home", "work", "transit", "business", "activity"].map(category => [
      category,
      navigation.places.filter(place => place.category === category).length,
    ])),
    { home: 1, work: 6, transit: 2, business: 2, activity: 5 },
  );
  assert.deepEqual(navigation.viewport, PHONE_MAP_VIEWPORT.width === 312
    ? { width: 312, height: 312 }
    : { width: PHONE_MAP_VIEWPORT.width, height: PHONE_MAP_VIEWPORT.height });

  const mapFeatures = state.world?.mapFeatures;
  assert.equal(mapFeatures?.northAxis, "+z");
  assert.deepEqual(mapFeatures?.roads?.x, [-168, -120, -72, -24, 24, 72, 120]);
  assert.deepEqual(mapFeatures?.roads?.z, [-168, -120, -72, -24, 24, 72, 120, 168]);
  assert.deepEqual(state.world?.roadCenters?.x, mapFeatures.roads.x);
  assert.deepEqual(state.world?.roadCenters?.z, mapFeatures.roads.z);
  assert.notEqual(mapFeatures.roads.x[0] % state.world.roadSpacing, 0,
    "native map regressed to the old incorrect zero-origin road grid");
  const player = positionOf(state.player);
  const north = projectWorldToMinimap(
    [player[0], player[1], player[2] + 48], player, state.world.minimapRadius,
  );
  const south = projectWorldToMinimap(
    [player[0], player[1], player[2] - 48], player, state.world.minimapRadius,
  );
  assert.ok(north.y < MINIMAP_RASTER_SIZE * 0.5,
    "positive authored Z must appear above the player on the north-up native GPS");
  assert.ok(south.y > MINIMAP_RASTER_SIZE * 0.5,
    "negative authored Z must appear below the player on the north-up native GPS");
  return {
    world: EXPECTED_WORLD_DESTINATIONS.length,
    businesses: businesses.length,
    standaloneActivities: standalone.length,
    canonicalPlaces: navigation.places.length,
    authoredRoads: mapFeatures.roads.x.length + mapFeatures.roads.z.length,
    northUpProjection: { north, south },
    story: 1,
  };
}

function verifyMinimapDiagnostics(state, label, {
  requiredCategories = [],
  minimumPlaced = 1,
} = {}) {
  const minimap = state.diagnostics?.minimap;
  assert.ok(minimap, `${label} has no native minimap diagnostics`);
  assert.equal(minimap.rasterWidth, MINIMAP_RASTER_SIZE);
  assert.equal(minimap.rasterHeight, MINIMAP_RASTER_SIZE);
  assert.equal(minimap.rasterScale, MINIMAP_RASTER_SCALE);
  assert.equal(minimap.placeIconPolicy, "immutable-mask-cache/single-pooled-texture");
  const stats = minimap.placeIconStats;
  assert.ok(stats && Number.isInteger(stats.placed), `${label} has no icon placement statistics`);
  assert.equal(stats.placed,
    EXPECTED_ICON_CATEGORIES.reduce((total, category) => total + Number(stats[category] ?? 0), 0),
  `${label} category totals do not equal the placed-icon count`);
  assert.ok(stats.placed >= minimumPlaced, `${label} rendered only ${stats.placed} readable destination icons`);
  for (const category of requiredCategories) {
    assert.ok(stats[category] >= 1, `${label} rendered no ${category} destination icon`);
  }
  return minimap;
}

function verifyFrameTiming(timing) {
  if (timing.stallFrames > 0 || timing.maximumMs >= 50 || timing.phases.maximumMs.worldStage >= 25) {
    console.error(JSON.stringify({ label: "high-resolution place minimap", timing }, null, 2));
  }
  assert.ok(timing.samples >= 20, `minimap timing collected only ${timing.samples} presented frames`);
  assert.ok(timing.p95Ms < 50, `minimap p95 frame time was ${timing.p95Ms.toFixed(1)}ms`);
  assert.equal(timing.stallFrames, 0,
    `high-resolution minimap contained ${timing.stallFrames} >50ms frame(s)`);
  assert.ok(timing.maximumMs < 50,
    `high-resolution minimap contained a ${timing.maximumMs.toFixed(1)}ms hitch`);
  assert.ok(timing.phases.maximumMs.worldStage < 25,
    `high-resolution minimap spent ${timing.phases.maximumMs.worldStage.toFixed(1)}ms in one world submission`);
}

async function main() {
  const client = await connectWithRetry(pipePath);
  let originalSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics?.backend, "NATIVE WEBGPU");
    originalSave = await client.request("save");
    state = await clearBlockingNarrative(client);
    if (state.player?.inVehicle) await client.request("exitVehicle");
    if (state.phone?.open) {
      await client.request("action", { action: "phone" });
      state = stateFrom(await client.request("advance", { steps: 2 }));
    }
    await client.request("clearWanted");
    await client.request("setTime", { dayIndex: 1, hours: 12.25 });
    await client.request("setWeather", { rain: 0.06, immediate: true });
    await client.request("teleport", { x: -8, z: 7 });
    await client.request("face", { x: 12, z: 45 });
    for (let index = 0; index < 4; ++index) await client.request("render");
    state = await client.request("snapshot");

    const sources = verifyPlaceSources(state);
    const initialMinimap = verifyMinimapDiagnostics(state, "initial centred map");
    const warmup = state.diagnostics.pipelineWarmup;
    assert.equal(warmup.storage, "memory-only");
    assert.equal(warmup.diskCache, false);
    assert.equal(warmup.textureStorage, "memory-only");
    assert.equal(warmup.textureDiskCache, false);
    assert.equal(warmup.allTextureSourcesReady, true);
    const hudPass = warmup.passes.find(pass => pass.label === "hud-all-panels-and-reticle");
    assert.ok(hudPass, "startup warmup omitted the HUD/minimap render pass");
    assert.equal(hudPass.textureNames.filter(name => name === "Neon City pooled raster navigation map").length, 1,
      "startup allocated more than one minimap texture");

    await client.request("resetFrameTiming");
    await wait(1_500);
    state = await client.request("snapshot");
    const timing = state.diagnostics.frameTiming;
    verifyFrameTiming(timing);
    const stableMinimap = verifyMinimapDiagnostics(state, "stationary map after 1.5 seconds");
    assert.deepEqual(stableMinimap, initialMinimap,
      "stationary map ticks changed place layout or immutable texture metadata");
    assert.equal(state.diagnostics.pipelineWarmup.textures, warmup.textures,
      "map updates allocated a runtime texture after READY");
    assert.equal(state.diagnostics.pipelineWarmup.explicitTextureUploads, warmup.explicitTextureUploads,
      "map updates changed the startup texture resource ledger");

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await client.request("screenshot", { path: screenshotPath });
    const capture = await stat(screenshotPath);
    assert.ok(capture.size >= 50_000,
      `native place-icon screenshot is unexpectedly small (${capture.size} bytes)`);

    console.log(JSON.stringify({
      ready: state.ready,
      backend: state.diagnostics.backend,
      screenshot: screenshotPath,
      screenshotBytes: capture.size,
      sources,
      minimap: stableMinimap,
      pooledMapTextures: 1,
      startupTextureCount: warmup.textures,
      frameTiming: timing,
    }, null, 2));
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "KeyS", down: false }).catch(() => {});
    if (originalSave) await client.request("restore", { snapshot: originalSave }).catch(() => {});
    client.close();
  }
}

await main();
