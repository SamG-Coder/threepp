import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_NAVIGATION_SAVE_VERSION,
  createMapNavigation,
  createMapPlaceDirectory,
  migrateMapNavigationSave,
  normalizeMapBounds,
} from "../src/game/map-navigation.mjs";

const BOUNDS = Object.freeze({ minX: -200, maxX: 200, minZ: -160, maxZ: 160 });
const PLACES = Object.freeze([
  Object.freeze({
    id: "common-ground-cafe",
    title: "COMMON GROUND",
    category: "business",
    icon: "coffee",
    address: "12 Civic Lane",
    position: Object.freeze({ x: -96, y: 0, z: 48 }),
    open: true,
    priority: 8,
  }),
  Object.freeze({
    id: "mina-market",
    name: "MINA'S MARKET",
    type: "work",
    iconId: "groceries",
    position: Object.freeze([-144, 0, 136]),
    open: false,
    priority: 9,
  }),
  Object.freeze({
    id: "pulse-garage",
    label: "PULSE GARAGE",
    category: "work",
    position: Object.freeze({ x: 96, z: -48 }),
    priority: 7,
  }),
]);

function assertDeepFrozenFinite(value, path = "value", seen = new Set()) {
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} is not frozen`);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number") assert.equal(Number.isFinite(child), true, `${path}.${key} is not finite`);
    assertDeepFrozenFinite(child, `${path}.${key}`, seen);
  }
}

test("authored place directories normalize aliases, reject drift, and stay deeply immutable", () => {
  assert.deepEqual(normalizeMapBounds({ min: { x: -2, z: -3 }, max: { x: 4, z: 5 } }), {
    minX: -2, maxX: 4, minZ: -3, maxZ: 5,
  });
  const directory = createMapPlaceDirectory(PLACES, BOUNDS);
  assert.equal(directory.length, 3);
  assert.equal(directory[1].title, "MINA'S MARKET");
  assert.equal(directory[1].category, "work");
  assert.deepEqual(directory[1].position, { x: -144, y: 0, z: 136 });
  assert.equal(directory[2].open, true);
  assertDeepFrozenFinite(directory);
  assert.throws(() => createMapPlaceDirectory([...PLACES, PLACES[0]], BOUNDS), /duplicate/i);
  assert.throws(() => createMapPlaceDirectory([{ id: "far", position: [900, 900] }], BOUNDS), /outside/i);
  assert.throws(() => normalizeMapBounds({ minX: 2, maxX: -2, minZ: 0, maxZ: 1 }), /positive area/i);
});

test("professional map projection, pan, and cursor-anchored zoom remain aligned and bounded", () => {
  const map = createMapNavigation({ places: PLACES, bounds: BOUNDS, viewport: { width: 400, height: 320 } });
  const cafeScreen = map.project(PLACES[0].position);
  const cafeWorld = map.unproject(cafeScreen);
  assert.ok(Math.abs(cafeWorld.x - PLACES[0].position.x) < 1e-9);
  assert.ok(Math.abs(cafeWorld.z - PLACES[0].position.z) < 1e-9);

  const anchor = { x: 72, y: 86 };
  const beforeAnchor = map.unproject(anchor);
  map.setZoom(3.5, anchor);
  const afterAnchor = map.unproject(anchor);
  assert.ok(Math.abs(beforeAnchor.x - afterAnchor.x) < 1e-9);
  assert.ok(Math.abs(beforeAnchor.z - afterAnchor.z) < 1e-9);
  map.zoomWheel(-100_000, anchor);
  assert.equal(map.snapshot().zoom, map.snapshot().maxZoom);
  map.zoomBy(-100, anchor);
  assert.equal(map.snapshot().zoom, map.snapshot().minZoom);

  map.setZoom(4);
  map.panBy(100_000, -100_000);
  const state = map.snapshot();
  assert.ok(state.center.x >= BOUNDS.minX && state.center.x <= BOUNDS.maxX);
  assert.ok(state.center.z >= BOUNDS.minZ && state.center.z <= BOUNDS.maxZ);
  assert.throws(() => map.setCenter({ x: Infinity, z: 0 }), /finite/i);
});

test("projection uses the shared GPS north-up cardinal orientation", () => {
  const map = createMapNavigation({
    places: PLACES,
    bounds: BOUNDS,
    viewport: { width: 400, height: 320 },
    initialZoom: 2,
  });
  const center = map.project({ x: 0, z: 0 });
  const north = map.project({ x: 0, z: 40 });
  const south = map.project({ x: 0, z: -40 });
  const east = map.project({ x: 40, z: 0 });
  const west = map.project({ x: -40, z: 0 });
  assert.ok(north.y < center.y, "positive world Z must appear above the player");
  assert.ok(south.y > center.y, "negative world Z must appear below the player");
  assert.ok(east.x > center.x, "positive world X must appear right of the player");
  assert.ok(west.x < center.x, "negative world X must appear left of the player");
  assert.deepEqual(map.unproject(north), { x: 0, y: 0, z: 40 });

  map.setZoom(4);
  const centerBeforeDrag = map.snapshot().center;
  map.panBy(0, 24);
  assert.ok(map.snapshot().center.z > centerBeforeDrag.z,
    "dragging the north-up map downward must reveal more southern map and move its center north");
});

test("mouse-up selects icons while a thresholded drag only pans the cached map", () => {
  const map = createMapNavigation({
    places: PLACES,
    bounds: BOUNDS,
    viewport: { width: 400, height: 320 },
    initialZoom: 2,
    open: true,
  });
  map.setCenter(PLACES[0].position);
  const cafeScreen = map.project(PLACES[0].position);
  assert.strictEqual(map.hitTest(cafeScreen), map.snapshot().places[0]);
  assert.equal(map.pointerDown({ ...cafeScreen, pointerId: 3 }).accepted, true);
  assert.equal(map.snapshot().selectedPlaceId, null, "press-down must not open or select a destination");
  const released = map.pointerUp({ ...cafeScreen, pointerId: 3 });
  assert.equal(released.kind, "navigate");
  assert.equal(map.snapshot().selectedPlaceId, "common-ground-cafe");
  assert.equal(map.snapshot().destinationId, "common-ground-cafe");
  assert.equal(map.snapshot().routeSource, "user_place");

  const centerBefore = map.snapshot().center;
  map.pointerDown({ x: 200, y: 160, pointerId: 4 });
  map.pointerMove({ x: 202, y: 162, pointerId: 4 });
  assert.equal(map.snapshot().gesture.dragging, false);
  map.pointerMove({ x: 250, y: 190, pointerId: 4 });
  const dragRelease = map.pointerUp({ x: 250, y: 190, pointerId: 4 });
  assert.equal(dragRelease.kind, "pan");
  assert.notDeepEqual(map.snapshot().center, centerBefore);
  assert.equal(map.snapshot().selectedPlaceId, "common-ground-cafe", "drag must not select a place under release");

  map.setOpen(false);
  assert.equal(map.pointerDown({ x: 0, y: 0 }).reason, "map_closed");
});

test("authored destinations and dropped pins expose one shared immutable HUD route target", () => {
  const map = createMapNavigation({ places: PLACES, bounds: BOUNDS });
  assert.strictEqual(map.setNavigation(), null);
  const selected = map.selectPlace("mina-market");
  assert.equal(selected.title, "MINA'S MARKET");
  const navigation = map.setNavigation();
  assert.equal(navigation.placeId, "mina-market");
  let state = map.snapshot();
  assert.strictEqual(state.routeTarget, state.navigationTarget);
  assert.strictEqual(state.routeTarget, state.navigation.target);
  assert.deepEqual(state.routeTarget, { x: -144, y: 0, z: 136 });
  assert.equal(state.selectedDestination.id, "mina-market");
  assertDeepFrozenFinite(state);

  const dropped = map.placeRouteTargetAt({ x: 180, y: 220 }, null, {
    title: "MEET HERE",
    category: "waypoint",
  });
  assert.equal(dropped.placeId, null);
  state = map.snapshot();
  assert.equal(state.navigation.title, "MEET HERE");
  assert.equal(state.navigation.source, "user_waypoint");
  assert.equal(state.selectedDestination, null);
  assert.ok(state.routeTarget.x >= BOUNDS.minX && state.routeTarget.x <= BOUNDS.maxX);
  assert.ok(state.routeTarget.z >= BOUNDS.minZ && state.routeTarget.z <= BOUNDS.maxZ);
  assert.strictEqual(map.clearNavigation(), null);
  assert.equal(map.snapshot().routeTarget, null);
});

test("a blank mouse-up drops a bounded user waypoint while drag-out never activates one", () => {
  const map = createMapNavigation({
    places: PLACES,
    bounds: BOUNDS,
    viewport: { width: 400, height: 320 },
    initialZoom: 3,
    open: true,
  });
  map.pointerDown({ x: 200, y: 160, pointerId: 7 });
  const dropped = map.pointerUp({ x: 200, y: 160, pointerId: 7 });
  assert.equal(dropped.kind, "drop_pin");
  assert.equal(map.snapshot().navigation.source, "user_waypoint");
  assert.deepEqual(map.snapshot().routeTarget, { x: 0, y: 0, z: 0 });

  map.clearNavigation();
  map.pointerDown({ x: 200, y: 160, pointerId: 8 });
  map.pointerMove({ x: 207, y: 160, pointerId: 8 });
  const panned = map.pointerUp({ x: 207, y: 160, pointerId: 8 });
  assert.equal(panned.kind, "pan");
  assert.equal(map.snapshot().navigation, null);
});

test("place availability refreshes without breaking a surviving destination or stale route cleanup", () => {
  const map = createMapNavigation({ places: PLACES, bounds: BOUNDS });
  map.selectPlace("mina-market");
  map.setNavigation();
  assert.equal(map.setPlaceOpen("mina-market", true), true);
  assert.equal(map.snapshot().selectedDestination.open, true);
  assert.equal(map.setPlaceOpen("unknown", true), false);
  const remaining = Object.freeze([PLACES[0], PLACES[2]]);
  map.refreshPlaces(remaining);
  assert.equal(map.snapshot().selectedDestination, null);
  assert.equal(map.snapshot().navigation, null);
  assert.equal(map.snapshot().places.length, 2);
});

test("v0 migration and v1 restore preserve navigation exactly and reject hostile state transactionally", () => {
  const map = createMapNavigation({
    places: PLACES,
    bounds: BOUNDS,
    viewport: { width: 400, height: 320 },
    initialZoom: 2,
  });
  const legacy = {
    version: 0,
    isOpen: true,
    centerX: -96,
    centerZ: 48,
    zoom: 2,
    selectedId: "common-ground-cafe",
    navigationId: "common-ground-cafe",
  };
  const migrated = migrateMapNavigationSave(legacy);
  assert.equal(migrated.version, MAP_NAVIGATION_SAVE_VERSION);
  map.restore(structuredClone(legacy));
  assert.deepEqual(map.save(), migrated);
  const restored = createMapNavigation({
    places: PLACES,
    bounds: BOUNDS,
    viewport: { width: 400, height: 320 },
  });
  restored.restore(structuredClone(map.save()));
  assert.deepEqual(restored.save(), map.save());
  assert.deepEqual(restored.snapshot(), map.snapshot());

  const before = map.save();
  const hostile = [
    { ...before, version: 99 },
    { ...before, open: "yes" },
    { ...before, zoom: Infinity },
    { ...before, zoom: 99 },
    { ...before, center: { x: 900, y: 0, z: 0 } },
    { ...before, selectedPlaceId: "forged-place" },
    { ...before, navigation: { placeId: "forged-place" } },
    { ...before, navigation: { placeId: null, target: { x: 900, z: 0 }, title: "X", category: "waypoint" } },
  ];
  for (const value of hostile) {
    assert.throws(() => map.restore(value));
    assert.deepEqual(map.save(), before, "restore rejection must not partially mutate navigation");
  }
});

test("snapshots and saves are identity-cached while RAM-only prewarm leaves live state untouched", () => {
  const map = createMapNavigation({ places: PLACES, bounds: BOUNDS, open: true });
  map.selectPlace("pulse-garage");
  map.setNavigation();
  const snapshot = map.snapshot();
  const saved = map.save();
  assert.strictEqual(map.snapshot(), snapshot);
  assert.strictEqual(map.save(), saved);
  assertDeepFrozenFinite(snapshot);
  assertDeepFrozenFinite(saved);
  const beforeBits = JSON.stringify(saved);
  const prepared = map.prewarm();
  assert.deepEqual(prepared, {
    ready: true,
    storage: "memory-only",
    diskResources: 0,
    rendererResources: 0,
    runtimeAssetsCreated: 0,
    placesPrepared: PLACES.length,
    hitTargetsPrepared: PLACES.length,
    zoomLevelsPrepared: 3,
    projectionDirectionsPrepared: 2,
    gestureBranchesPrepared: 4,
    saveRestorePrepared: true,
    liveStatePreserved: true,
    checksum: prepared.checksum,
  });
  assert.ok(prepared.checksum > 0);
  assert.strictEqual(map.prewarm(), prepared);
  assert.strictEqual(map.snapshot(), snapshot);
  assert.strictEqual(map.save(), saved);
  assert.equal(JSON.stringify(map.save()), beforeBits);
  assertDeepFrozenFinite(prepared);
});
