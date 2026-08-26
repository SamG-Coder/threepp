import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";

import {
  createGtaHud,
  isAuthoredNarrativePresentation,
  MINIMAP_PLACE_ICON_MASKS,
  MINIMAP_PLACE_ICON_PALETTE,
  MINIMAP_RASTER_SCALE,
  MINIMAP_RASTER_SIZE,
  PHONE_MAP_VIEWPORT,
  phoneCanvasTransform,
  phoneRasterSignature,
  planGridRoute,
  projectWorldToMinimap,
} from "../src/ui/hud.mjs";

test("seven-app phone launcher stays resident across clock hover press and scroll changes", () => {
  const base = {
    open: true,
    app: null,
    title: "NEON LIFE",
    subtitle: "YOUR CITY IN YOUR POCKET",
    time: "07:12",
    scroll: 0,
    hover: -1,
    pressed: false,
    items: [
      { title: "PULSE PAY", detail: "MONEY AND COMMUNITY TRUST" },
      { title: "OPEN DOORS", detail: "LOCAL STORES AND HOURS" },
      { title: "CITY WORK", detail: "LAWFUL JOBS AND ACTIVITIES" },
      { title: "CONTACTS", detail: "PEOPLE WHO KNOW KAI" },
      { title: "LIFE PROFILE", detail: "SKILLS, ENERGY, AND WORK HISTORY" },
      { title: "MY HOME", detail: "ROOMS, ROUTINES, AND HOUSEHOLD" },
      { title: "NEON MAP", detail: "PLACES, ROUTES, AND LIVE NAVIGATION" },
    ],
  };
  const signature = phoneRasterSignature(base);
  assert.notEqual(phoneRasterSignature({ ...base, items: base.items.slice(0, 6) }), signature,
    "the complete seven-app launcher must be part of the resident raster identity");
  assert.equal(phoneRasterSignature({ ...base, time: "07:13" }), signature);
  assert.equal(phoneRasterSignature({ ...base, hover: 0, pressed: true }), signature);
  assert.equal(phoneRasterSignature({ ...base, scroll: 3 }), signature);
  assert.equal(phoneRasterSignature({ ...base, openProgress: 0.4, appProgress: 0.7 }), signature,
    "GPU-only phone transitions must not invalidate the cached canvas");
});

test("phone app animation preserves the full cached canvas dimensions", () => {
  const home = phoneCanvasTransform(false, 1);
  const opened = phoneCanvasTransform(true, 1);
  const entering = phoneCanvasTransform(true, 0);
  assert.deepEqual(home, { scaleX: 348, scaleY: 548, centerY: 311 });
  assert.deepEqual(opened, home, "a completed app transition must fill the phone screen");
  assert.ok(entering.scaleX > 300, "the cached canvas must never collapse to unit width");
  assert.ok(entering.scaleY > 0 && entering.scaleY < opened.scaleY);
  assert.ok(entering.centerY > opened.centerY, "the app should reveal upward from the bottom");
});

test("phone retains a dedicated launcher layer behind the animated app canvas", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const launcher = hud.scene.getObjectByName("Neon Life retained launcher behind app transitions");
    const app = hud.scene.getObjectByName("Neon Life canvas-generated app grid and high-resolution text");
    assert.ok(launcher?.isMesh && app?.isMesh);
    assert.notStrictEqual(launcher.material.map, app.material.map,
      "the app reveal must not overwrite the launcher texture it animates over");
    assert.equal(launcher.material.map.userData.phoneRasterPolicy, "immutable-startup-data",
      "the six launcher icons must be detached from the native canvas and uploaded during startup");
    assert.equal(app.material.map.userData.phoneRasterPolicy, "immutable-app-cache",
      "app chrome must select an immutable startup texture rather than a live CanvasTexture");
    const appCanvases = [];
    hud.scene.traverse(object => {
      if (object.isMesh && object.userData?.phoneAppId) appCanvases.push(object);
    });
    assert.equal(appCanvases.length, 8,
      "the seven launcher apps and Android-style recents screen must all be resident before play");
    assert.ok(appCanvases.every(canvas => canvas.material.map.userData.phoneAppId === canvas.userData.phoneAppId));
    assert.equal(new Set(appCanvases.map(canvas => canvas.material)).size, 8,
      "every cached texture/material pairing must exist before reveal-all warmup");
    assert.ok(launcher.renderOrder < app.renderOrder,
      "the retained launcher belongs immediately behind the rising app canvas");
  } finally {
    hud.dispose();
  }
});

test("first app open switching scrolling and live values never dirty the resident phone texture cache", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const appCanvases = [];
    hud.scene.traverse(object => {
      if (object.isMesh && object.userData?.phoneAppId) appCanvases.push(object);
    });
    const appCanvas = appCanvases.find(canvas => canvas.userData.phoneAppId === "wallet");
    const glyphLayer = hud.scene.getObjectByName("Neon Life fixed live app glyph layer");
    const textures = appCanvases.map(canvas => canvas.material.map);
    const ids = appCanvases.map(canvas => canvas.userData.phoneAppId);
    assert.deepEqual(ids, ["wallet", "places", "work", "contacts", "profile", "home", "map", "recents"]);
    assert.ok(textures.every(texture => texture.userData.phoneRasterPolicy === "immutable-app-cache"));
    assert.ok(textures.every(texture => texture.flipY === false), "all cached app rasters must share native WebGPU orientation");
    const versions = textures.map(texture => texture.version);
    const launcherRedraws = hud.phoneCanvasRedrawCount;
    const appCacheRedraws = hud.phoneAppCacheRedrawCount;
    const geometry = appCanvas.geometry;

    const snapshot = (app, overrides = {}) => ({
      elapsed: 8,
      capture: { locked: true },
      player: { position: [0, 0.34, 0], health: 100, stamina: 100, armor: 0, alive: true },
      phone: {
        open: true,
        app,
        title: app === "wallet" ? "PULSE PAY" : app.toUpperCase(),
        subtitle: "LIVE CITY DATA",
        time: "07:53",
        selection: 0,
        scroll: 0,
        hover: -1,
        pressed: false,
        openProgress: 1,
        appProgress: 1,
        items: [
          { title: "LIVE BALANCE", detail: "$1,250 AVAILABLE" },
          { title: "SECOND ROW", detail: "CURRENT WORLD STATE" },
          { title: "THIRD ROW", detail: "NO STALE PLACEHOLDER" },
          { title: "FOURTH ROW", detail: "STILL RESIDENT" },
          { title: "FIFTH ROW", detail: "SCROLL TARGET" },
          { title: "SIXTH ROW", detail: "GLYPH DATA ONLY" },
        ],
        ...overrides,
      },
    });

    hud.update(snapshot("wallet", { appProgress: 0 }));
    assert.equal(appCanvases.find(canvas => canvas.userData.phoneSelected)?.userData.phoneAppId, "wallet");
    assert.ok(glyphLayer.children.filter(child => child.material).every(child => child.material.opacity === 0),
      "live rows should remain transparent until the cached chrome has covered the launcher");
    assert.equal(glyphLayer.position.y, 32);
    hud.update(snapshot("wallet", { appProgress: 0.5, time: "07:54", hover: 1, pressed: true }));
    assert.ok(glyphLayer.children.filter(child => child.material).every(child => child.material.opacity === 0));
    hud.update(snapshot("wallet", { appProgress: 0.75, time: "07:54" }));
    assert.ok(glyphLayer.children.some(child => child.material?.opacity > 0));
    assert.ok(glyphLayer.position.y > 0 && glyphLayer.position.y < 32);
    hud.update(snapshot("wallet", { appProgress: 1, scroll: 1 }));
    assert.equal(glyphLayer.position.y, 0);
    const visibleText = [];
    glyphLayer.traverse(object => {
      if (object.visible && typeof object.userData?.text === "string") visibleText.push(object.userData.text);
    });
    assert.ok(visibleText.some(value => value.includes("SECOND ROW")), "scrolling should refresh only the fixed glyph buffers");

    for (const id of ["places", "work", "contacts", "profile", "home", "map", "recents", "wallet"]) {
      hud.update(snapshot(id, { appProgress: id === "wallet" ? 0.35 : 1 }));
      assert.equal(appCanvases.find(canvas => canvas.userData.phoneSelected)?.userData.phoneAppId, id);
      assert.equal(appCanvas.material.map.userData.phoneAppId, "wallet",
        "switching apps must never swap an existing material's texture binding");
    }
    hud.update(snapshot("wallet", {
      title: "PULSE PAY",
      items: [{ title: "LIVE BALANCE", detail: "$1,375 AVAILABLE" }],
    }));
    const changedLiveText = [];
    glyphLayer.traverse(object => {
      if (object.visible && typeof object.userData?.text === "string") changedLiveText.push(object.userData.text);
    });
    assert.ok(changedLiveText.some(value => value.includes("$1,375 AVAILABLE")),
      "actual changed values must update through the small glyph layer");
    assert.deepEqual(textures.map(texture => texture.version), versions,
      "opening, switching, scrolling, clock ticks and actual data changes must not request any texture upload");
    assert.equal(hud.phoneCanvasRedrawCount, launcherRedraws);
    assert.equal(hud.phoneAppCacheRedrawCount, appCacheRedraws);
    assert.equal(hud.phoneAppCacheTextureCount, 8);
    assert.strictEqual(appCanvas.geometry, geometry);
  } finally {
    hud.dispose();
  }
});

test("phone Map app shares the retained GPS texture and reserves route controls ahead of map taps", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const phone = hud.scene.getObjectByName("Neon Life preloaded interactive phone");
    const mapViewport = hud.scene.getObjectByName("Neon Life phone GPS shares HUD minimap texture");
    assert.ok(phone?.isGroup && mapViewport?.isMesh);
    assert.strictEqual(mapViewport.material.map, hud.minimapTexture,
      "the phone must not create a duplicate map texture");
    assert.deepEqual(PHONE_MAP_VIEWPORT, { left: 39, top: 151, width: 312, height: 312 });

    const mapNavigation = {
      revision: 4,
      bounds: { minX: -192, maxX: 192, minZ: -192, maxZ: 620 },
      viewport: PHONE_MAP_VIEWPORT,
      center: { x: 0, y: 0, z: 0 },
      zoom: 2.4,
      navigation: {
        title: "ASHWIND RUINS",
        category: "activity",
        source: "user_place",
        target: { x: 0, y: 0, z: 505 },
      },
      selectedDestination: null,
      places: [],
    };
    const snapshot = {
      elapsed: 7,
      capture: { locked: true },
      player: { position: [0, 0.34, 0], yaw: 0, health: 100, stamina: 100, armor: 0, alive: true },
      phone: {
        open: true,
        app: "map",
        title: "NEON MAP",
        subtitle: "NAVIGATING TO ASHWIND RUINS",
        time: "09:14",
        selection: 0,
        scroll: 0,
        hover: -1,
        pressed: false,
        openProgress: 1,
        appProgress: 1,
        items: [],
        mapNavigation,
      },
      world: {
        bounds: { minX: -192, maxX: 155, minZ: -192, maxZ: 192 },
        mapFeatures: {
          bounds: mapNavigation.bounds,
          cityBounds: { minX: -192, maxX: 155, minZ: -192, maxZ: 192 },
          roads: {
            halfWidth: 6,
            bounds: { minX: -192, maxX: 155, minZ: -192, maxZ: 192 },
            x: [-168, -120, -72, -24, 24, 72, 120],
            z: [-168, -120, -72, -24, 24, 72, 120, 168],
          },
          areas: [],
          buildings: [],
        },
      },
      vehicles: [],
      population: [],
      targetPosition: [0, 0, 505],
      mission: { stage: "complete" },
    };
    const cachedTextures = [];
    hud.scene.traverse(object => {
      if (object.isMesh && object.userData?.phoneAppId) cachedTextures.push(object.material.map);
    });
    const cacheVersions = cachedTextures.map(texture => texture.version);
    hud.update(snapshot);
    assert.equal(mapViewport.visible, true);

    const clientPoint = (x, y) => ({
      x: phone.position.x + x * phone.scale.x,
      y: phone.position.y + y * phone.scale.y,
    });
    const mapHitPoint = clientPoint(PHONE_MAP_VIEWPORT.left + 100, PHONE_MAP_VIEWPORT.top + 100);
    assert.deepEqual(hud.phoneHitTest(mapHitPoint.x, mapHitPoint.y), { type: "map", x: 100, y: 100 });
    const clearPoint = clientPoint(298, 498);
    assert.deepEqual(hud.phoneHitTest(clearPoint.x, clearPoint.y), { type: "mapRoute" });

    hud.update({
      ...snapshot,
      phone: {
        ...snapshot.phone,
        mapNavigation: { ...mapNavigation, revision: 5, center: { x: 24, y: 0, z: 72 }, zoom: 3.1 },
      },
    });
    assert.deepEqual(cachedTextures.map(texture => texture.version), cacheVersions,
      "panning and zooming may update the one retained GPS texture but never app canvas caches");
    assert.strictEqual(mapViewport.material.map, hud.minimapTexture);
  } finally {
    hud.dispose();
  }
});

test("phone construction falls back without recursion when a 2D canvas context is unavailable", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return { width: 0, height: 0, getContext: () => null };
    },
  };
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  let hud = null;
  try {
    hud = createGtaHud({ renderer });
    assert.equal(hud.phoneAppCacheTextureCount, 8);
    const launcher = hud.scene.getObjectByName("Neon Life retained launcher behind app transitions");
    assert.equal(launcher.material.map.userData.phoneRasterPolicy, "immutable-startup-data");
  } finally {
    hud?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("minimap navigation plans a deterministic axis-aligned road route", () => {
  const start = { x: 7, z: 11 };
  const target = [137, 0, -101];
  const first = planGridRoute(start, target, 48, {
    minX: -192,
    maxX: 192,
    minZ: -192,
    maxZ: 192,
  });
  const second = planGridRoute(start, target, 48, {
    minX: -192,
    maxX: 192,
    minZ: -192,
    maxZ: 192,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first[0], { x: 7, y: 0, z: 11 });
  assert.deepEqual(first.at(-1), { x: 137, y: 0, z: -101 });
  assert.ok(Object.isFrozen(first));
  for (const point of first) {
    assert.ok(Object.isFrozen(point));
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
  }
  for (let index = 1; index < first.length; ++index) {
    const previous = first[index - 1];
    const current = first[index];
    assert.ok(previous.x === current.x || previous.z === current.z, "route segments must follow grid axes");
  }
  assert.ok(first.slice(1, -1).some(point => point.x % 48 === 0 || point.z % 48 === 0));
});

test("GPS route snapping and cardinal projection use the exact authored north-up city contract", () => {
  const roadCenters = {
    halfWidth: 6,
    x: [-168, -120, -72, -24, 24, 72, 120],
    z: [-168, -120, -72, -24, 24, 72, 120, 168],
  };
  const route = planGridRoute(
    [0, 0, 0],
    [100, 0, 100],
    48,
    { minX: -192, maxX: 192, minZ: -192, maxZ: 620 },
    roadCenters,
  );
  assert.deepEqual(route, [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -24 },
    { x: 120, y: 0, z: -24 },
    { x: 120, y: 0, z: 100 },
    { x: 100, y: 0, z: 100 },
  ], "the route must use z=-24/x=120 roads, never inferred z=0/x=96 block centres");
  assert.ok(route.slice(1, -1).every(point =>
    roadCenters.x.includes(point.x) || roadCenters.z.includes(point.z)));

  const center = projectWorldToMinimap([0, 0, 0], [0, 0, 0], 104);
  const east = projectWorldToMinimap([24, 0, 0], [0, 0, 0], 104);
  const north = projectWorldToMinimap([0, 0, 24], [0, 0, 0], 104);
  assert.ok(east.x > center.x && east.y === center.y, "+X must project right");
  assert.ok(north.y < center.y && north.x === center.x, "+Z/north must project up");
});

test("minimap navigation clamps endpoints to the authored city bounds", () => {
  const route = planGridRoute([500, 0, -500], [-500, 0, 500], 48, {
    minX: -192,
    maxX: 192,
    minZ: -192,
    maxZ: 192,
  });
  assert.deepEqual(route[0], { x: 192, y: 0, z: -192 });
  assert.deepEqual(route.at(-1), { x: -192, y: 0, z: 192 });
  assert.deepEqual(planGridRoute(null, [0, 0, 0]), []);
});

test("minimap raster contains visible roads, route, people and a centered player marker", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    hud.update({
      elapsed: 2,
      capture: { locked: true },
      player: { position: [0, 0, 0], yaw: 0, health: 100, stamina: 100, armor: 0, alive: true },
      world: {
        bounds: { minX: -192, maxX: 155, minZ: -192, maxZ: 192 },
        roadSpacing: 48,
        minimapRadius: 104,
        district: { name: "Pulse Core" },
      },
      vehicles: [{ id: "commuter", position: [14, 0, 10] }],
      population: [{ id: "neighbour", position: [-9, 0, 8] }],
      lifeActivities: [
        { kind: "volunteer", hubPosition: [68, 0, 60] },
        { kind: "basketball", hubPosition: [-68, 0, 60] },
      ],
      neighbourhood: {
        appetiteStatus: "STEADY",
        businesses: [
          { position: [-20, 0, 12], open: true },
          { position: [20, 0, 12], open: false },
        ],
      },
      mission: { stage: "available", startPosition: [42, 0, 44] },
    });
    const bytes = hud.minimapTexture.image.data;
    const center = Math.floor(hud.minimapTexture.image.width * 0.5);
    const centerOffset = (center * hud.minimapTexture.image.width + center) * 4;
    assert.deepEqual([...bytes.slice(centerOffset, centerOffset + 4)], [104, 238, 255, 255]);
    let routePixels = 0;
    let civilianPixels = 0;
    let basketballPixels = 0;
    let businessPixels = 0;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      if (bytes[offset] === 38 && bytes[offset + 1] === 224 && bytes[offset + 2] === 242) routePixels += 1;
      if (bytes[offset] === 236 && bytes[offset + 1] === 189 && bytes[offset + 2] === 74) civilianPixels += 1;
      if (bytes[offset] === 255 && bytes[offset + 1] === 164 && bytes[offset + 2] === 76) basketballPixels += 1;
      if (bytes[offset] === 255 && bytes[offset + 1] === 190 && bytes[offset + 2] === 92) businessPixels += 1;
    }
    assert.ok(routePixels > 20, `expected a visible cyan route, found ${routePixels} pixels`);
    assert.ok(civilianPixels > 0, "expected a visible civilian blip");
    assert.ok(basketballPixels > 0, "expected a distinct orange Harbour Court blip");
    assert.ok(businessPixels > 0, "expected an amber open-business marker");
    assert.ok(hud.minimapTexture.version > 0);
  } finally {
    hud.dispose();
  }
});

test("2x retained minimap renders distinct cached place symbols with deterministic priority culling", () => {
  assert.equal(MINIMAP_RASTER_SCALE, 2);
  assert.equal(MINIMAP_RASTER_SIZE, 392);
  const maskSignatures = Object.values(MINIMAP_PLACE_ICON_MASKS).map(mask => mask.join("/"));
  assert.equal(new Set(maskSignatures).size, 7, "every destination category needs its own silhouette");
  assert.ok(Object.values(MINIMAP_PLACE_ICON_MASKS).every(mask => Object.isFrozen(mask)));

  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const placeSnapshot = {
      elapsed: 1,
      capture: { locked: true },
      player: { position: [0, 0, 0], yaw: 0, health: 100, stamina: 100, armor: 0, alive: true },
      world: {
        bounds: { minX: -192, maxX: 192, minZ: -192, maxZ: 192 },
        roadSpacing: 48,
        minimapRadius: 104,
        district: { name: "Pulse Core" },
        residentialInterior: { entrance: { exterior: [-72, 0.2, -68] } },
        pulseTransit: { entrance: [72, 0.2, -68] },
        pulseGarageInterior: { entrance: { exterior: [-72, 0.2, 68] } },
      },
      vehicles: [],
      population: [],
      lifeActivities: [{ id: "photo-walk", kind: "photography", hubPosition: [0, 0.2, 70] }],
      neighbourhood: {
        businesses: [{ id: "corner-shop", position: [72, 0.2, 68], open: true }],
      },
      mission: { stage: "available", startPosition: [0, 0.2, -72] },
    };
    const retainedTexture = hud.minimapTexture;
    hud.update(placeSnapshot);
    assert.strictEqual(hud.minimapTexture, retainedTexture, "map updates must reuse one startup texture");
    assert.equal(retainedTexture.image.width, MINIMAP_RASTER_SIZE);
    assert.equal(retainedTexture.image.height, MINIMAP_RASTER_SIZE);
    assert.equal(retainedTexture.userData.minimapRasterScale, 2);
    assert.equal(retainedTexture.userData.placeIconPolicy, "immutable-mask-cache/single-pooled-texture");
    assert.deepEqual(hud.minimapPlaceIconStats, {
      business: 1,
      home: 1,
      work: 1,
      activity: 1,
      transit: 1,
      story: 1,
      waypoint: 0,
      culled: 0,
      placed: 6,
    });

    const colorCounts = new Map();
    const bytes = retainedTexture.image.data;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const signature = `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]},${bytes[offset + 3]}`;
      colorCounts.set(signature, (colorCounts.get(signature) ?? 0) + 1);
    }
    for (const category of ["business", "home", "work", "activity", "transit", "story"]) {
      const signature = MINIMAP_PLACE_ICON_PALETTE[category].join(",");
      assert.ok((colorCounts.get(signature) ?? 0) >= 20, `${category} needs a visible high-resolution pixel signature`);
    }

    // All landmarks deliberately overlap here. The plain {x,y,z} story target
    // must render and reserve the location before homes, work, transit, shops
    // or activities can obscure it.
    const shared = [36, 0.2, 36];
    hud.update({
      ...placeSnapshot,
      elapsed: 1.1,
      world: {
        ...placeSnapshot.world,
        residentialInterior: { entrance: { exterior: shared } },
        pulseTransit: { entrance: shared },
        pulseGarageInterior: { entrance: { exterior: shared } },
      },
      lifeActivities: [{ id: "photo-walk", kind: "photography", hubPosition: shared }],
      neighbourhood: { businesses: [{ id: "corner-shop", position: shared, open: true }] },
      mission: { stage: "available", startPosition: shared },
    });
    assert.deepEqual(hud.minimapPlaceIconStats, {
      business: 0,
      home: 0,
      work: 0,
      activity: 0,
      transit: 0,
      story: 1,
      waypoint: 0,
      culled: 5,
      placed: 1,
    });
    assert.strictEqual(hud.minimapTexture, retainedTexture);
  } finally {
    hud.dispose();
  }
});

test("Open Doors uses one fixed GPU menu pool with readable affordability and appetite state", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const menuItems = [
      { id: "meal", name: "MARKET JOLLOF BOX", cost: 24, heal: 8, stamina: 14, appetite: 34 },
      { id: "wrap", name: "PLANTAIN AND BEAN WRAP", cost: 17, heal: 4, stamina: 15, appetite: 25 },
      { id: "tea", name: "CHILLED HIBISCUS TEA", cost: 80, heal: 1, stamina: 19, appetite: 7 },
      { id: "pay_a_meal_forward", name: "PAY A MEAL FORWARD", cost: 18, payForward: true },
      { id: "weekly_grocery_bag", name: "WEEKLY GROCERY BAG", cost: 18, kind: "household_supplies", inventoryEffects: { groceries: 5 } },
    ];
    const base = {
      elapsed: 12,
      capture: { locked: true },
      player: { position: [-144, 0.2, 127], health: 82, stamina: 55, armor: 0, cash: 40, alive: true },
      neighbourhood: {
        menuOpen: true,
        businessName: "MINA'S MARKET KITCHEN",
        keeperName: "MINA OKAFOR",
        openingHours: { label: "07:00-21:00" },
        keeperLine: "MINA OKAFOR: A market remembers who shows up when the shutters are heavy.",
        familiarity: 2,
        appetite: 31,
        appetiteStatus: "PECKISH",
        selectionIndex: 0,
        menuItems,
        businesses: [{ position: [-144, 0.2, 127], open: true }],
      },
    };
    const meshCount = () => {
      let count = 0;
      hud.scene.traverse(object => { if (object.isMesh) count += 1; });
      return count;
    };
    const before = meshCount();
    hud.update(base);
    const group = hud.scene.getObjectByName("Open Doors fixed neighbourhood shop panel");
    assert.ok(group?.visible);
    const backdrop = hud.scene.getObjectByName("Open Doors modal backdrop");
    const modalText = ["title", "hours", "keeper", "vitals", "dialogue", "hint"]
      .map(name => hud.scene.getObjectByName(`Open Doors modal ${name}`));
    assert.ok(modalText.every(mesh => mesh?.renderOrder > backdrop.renderOrder),
      "transparent shop text must render after the opaque-black modal backdrop");
    const rows = Array.from({ length: 5 }, (_, index) => hud.scene.getObjectByName(`Open Doors fixed menu row ${index + 1}`));
    assert.ok(rows.every(row => row?.visible));
    const rowGeometries = rows.map(row => row.geometry);
    const rowPositionBuffers = rows.map(row => row.geometry.getAttribute("position").array);
    const rowUvBuffers = rows.map(row => row.geometry.getAttribute("uv").array);
    const rowPositionVersions = rows.map(row => row.geometry.getAttribute("position").version);
    const rowUvVersions = rows.map(row => row.geometry.getAttribute("uv").version);
    for (const row of rows) {
      assert.equal(row.geometry.getAttribute("position").usage, THREE.StaticDrawUsage);
      assert.equal(row.geometry.getAttribute("uv").usage, THREE.StaticDrawUsage);
      assert.notEqual(row.geometry.getAttribute("position").usage, THREE.DynamicDrawUsage,
        "fixed text buffers must not be uploaded as per-frame dynamic streams");
    }
    assert.match(rows[0].userData.text, /MARKET JOLLOF BOX.*HEALTH \+8.*FED \+34/);
    assert.equal(rows[2].material.color.getHex(), 0x7c8795, "unaffordable food should be visibly muted");
    assert.match(rows[3].userData.text, /NO BUFF.*SOMEONE EATS LATER/);
    assert.match(rows[4].userData.text, /WEEKLY GROCERY BAG.*TAKE HOME.*PANTRY \+5/);
    hud.update({ ...base, neighbourhood: { ...base.neighbourhood, selectionIndex: 3, consuming: true, consumeProgress: 0.5 } });
    assert.equal(meshCount(), before, "menu navigation must reuse its fixed mesh pool");
    for (let index = 0; index < rows.length; ++index) {
      assert.strictEqual(rows[index].geometry, rowGeometries[index],
        "changing shop strings must update fixed glyph geometries in place");
      assert.strictEqual(rows[index].geometry.getAttribute("position").array, rowPositionBuffers[index],
        "changing shop strings must retain fixed position buffers");
      assert.strictEqual(rows[index].geometry.getAttribute("uv").array, rowUvBuffers[index],
        "changing shop strings must retain fixed UV buffers");
    }
    assert.ok(rows[0].geometry.getAttribute("position").version > rowPositionVersions[0]);
    assert.ok(rows[0].geometry.getAttribute("uv").version > rowUvVersions[0]);
    assert.ok(rows[3].geometry.getAttribute("position").version > rowPositionVersions[3]);
    const stablePositionVersions = rows.map(row => row.geometry.getAttribute("position").version);
    const stableUvVersions = rows.map(row => row.geometry.getAttribute("uv").version);
    hud.update({ ...base, neighbourhood: { ...base.neighbourhood, selectionIndex: 3, consuming: true, consumeProgress: 0.5 } });
    assert.deepEqual(rows.map(row => row.geometry.getAttribute("position").version), stablePositionVersions,
      "unchanged menu text must not schedule redundant position uploads");
    assert.deepEqual(rows.map(row => row.geometry.getAttribute("uv").version), stableUvVersions,
      "unchanged menu text must not schedule redundant UV uploads");
    assert.equal(rows[3].material.color.getHex(), 0xffd17a);
  } finally {
    hud.dispose();
  }
});

test("Harbour Court renders its live release track through the proven text atlas", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    hud.update({
      elapsed: 3,
      capture: { locked: true },
      player: { position: [140.6, 0.34, -96], health: 100, stamina: 100, armor: 0, alive: true },
      activity: {
        kind: "basketball",
        title: "HARBOUR COURT",
        stage: "charging",
        status: "active",
        objective: "PRESS E IN THE GREEN WINDOW TO RELEASE",
        charge: 0.7,
        targetRelease: 0.72,
        goodWindow: 0.135,
        stopIndex: 0,
        stopCount: 5,
        made: 0,
        points: 0,
        trustReward: 2,
      },
    });
    const meter = hud.scene.getObjectByName("Harbour Court atlas timing meter");
    assert.ok(meter?.visible, "expected the atlas timing track to be visible while charging");
    assert.match(meter.userData.text, /^POWER [-=I#]{26}$/);
    assert.ok(meter.userData.text.includes("="), "expected a readable sweet-release band");
    assert.ok(meter.userData.text.includes("#"), "expected a readable live release marker");
  } finally {
    hud.dispose();
  }
});

test("Pulse Garage uses mechanic progress instead of generic undefined task counters", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    hud.update({
      elapsed: 3,
      capture: { locked: true },
      player: { position: [-153, 0.34, 84], health: 100, stamina: 100, armor: 0, alive: true },
      activity: {
        kind: "mechanic",
        title: "PULSE GARAGE APPRENTICE",
        stage: "inspection",
        status: "active",
        objective: "INSPECT THE VEHICLE METHODICALLY",
        quality: 100,
        workMinutes: 8,
        inspectionClues: [{ id: "slow_crank" }],
        targetPosition: [-154, 0.34, 89],
      },
    });
    const detail = hud.scene.getObjectByName("Mission activity detail line")?.userData?.text;
    assert.equal(detail, "QUALITY 100% CLUES 1/3");
    assert.doesNotMatch(detail, /NAN|UNDEFINED/);
  } finally {
    hud.dispose();
  }
});

test("Harbour Skills House shows finite physical-step progress instead of a generic payout", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    hud.update({
      elapsed: 3,
      capture: { locked: true },
      player: { position: [96.7, 0.34, 44], health: 100, stamina: 100, armor: 0, alive: true },
      activity: {
        kind: "community",
        title: "COMMUNITY KITCHEN SHIFT",
        stage: "working",
        status: "active",
        objective: "RANGE AND TEMPERATURE PROBE  47%",
        taskIndex: 2,
        taskCount: 4,
        taskProgress: 0.47,
        safetyRequired: true,
        estimatedWage: 54,
        targetPosition: [91, 0.2, 45],
      },
    });
    const detail = hud.scene.getObjectByName("Mission activity detail line")?.userData?.text;
    assert.equal(detail, "STEP 3/4 WORK 47% SAFETY CHECK");
    assert.doesNotMatch(detail, /NAN|UNDEFINED|TRUST \+0|PAY \$0/);
  } finally {
    hud.dispose();
  }
});

test("Common Ground cafe shows finite hospitality progress without generic activity fields", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const base = {
      elapsed: 3,
      capture: { locked: true },
      player: { position: [-40, 0.34, -12], health: 100, stamina: 100, armor: 0, alive: true },
      activity: {
        kind: "cafe",
        title: "COMMON GROUND CAFE SHIFT",
        stage: "working",
        status: "active",
        objective: "PREPARE THE ACCESSIBLE ORDER CAREFULLY",
        taskIndex: 2,
        taskCount: 6,
        taskProgress: 0.47,
        estimatedWage: 58,
        quality: 92,
        reworkCount: 1,
        safetyRequired: true,
        targetPosition: [-40, 0.2, -9],
      },
    };
    const detail = hud.scene.getObjectByName("Mission activity detail line");
    const geometry = detail.geometry;
    const positions = geometry.getAttribute("position").array;
    const uvs = geometry.getAttribute("uv").array;
    hud.update(base);
    assert.equal(detail.userData.text, "STEP 3/6 WORK 47% Q92 SAFE R1");
    assert.doesNotMatch(detail.userData.text, /NAN|UNDEFINED|PAYOUT|TRUST \+0|PAY \$0/);
    const title = [];
    hud.scene.traverse(object => {
      if (object.userData?.text === "COMMON GROUND CAFE SHIFT") title.push(object);
    });
    assert.equal(title.length, 1);
    assert.equal(title[0].material.color.getHex(), 0xffd17a,
      "the cafe should use the warm hospitality accent instead of a generic activity color");

    hud.update({
      ...base,
      activity: {
        ...base.activity,
        stage: "cafe-till",
        taskProgress: Number.NaN,
        estimatedWage: Number.NaN,
        quality: undefined,
        reworkCount: Number.NaN,
      },
    });
    assert.equal(detail.userData.text, "STEP 3/6 TILL WAGE $0 Q0 SAFE");
    assert.doesNotMatch(detail.userData.text, /NAN|UNDEFINED|PAYOUT|TRUST/);
    assert.strictEqual(detail.geometry, geometry);
    assert.strictEqual(detail.geometry.getAttribute("position").array, positions);
    assert.strictEqual(detail.geometry.getAttribute("uv").array, uvs);
    assert.equal(detail.geometry.getAttribute("position").usage, THREE.StaticDrawUsage);
  } finally {
    hud.dispose();
  }
});

test("activities reuse one black-backed non-blocking conversation card without HUD overlap", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  const base = {
    elapsed: 12,
    capture: { locked: true },
    player: { position: [0, 0, 0], health: 100, stamina: 100, armor: 0, cash: 240, alive: true },
    vehicle: { id: "taxi", kind: "taxi", position: [0, 0, 0], speed: 0, health: 120, maxHealth: 120 },
    prompt: "F EXIT  DRIVE TO THE DESTINATION",
    toast: "THIS TOAST MUST YIELD TO THE PASSENGER",
    toastUntil: 99,
    activity: {
      kind: "taxi",
      title: "NEON TAXI",
      status: "active",
      stage: "boarding",
      objective: "WAIT WHILE SAMIRA BOARDS",
      passenger: "Samira Cole",
      passengerRole: "Home-care assistant",
      boardingRatio: 0.63,
      qualityGrade: "S",
      estimatedReward: 420,
      dialogue: {
        serial: 1,
        active: true,
        kind: "board",
        speaker: "Samira Cole",
        role: "Home-care assistant",
        text: "Harbour gate three, please. Mrs Vale locks the chain if I’m more than ten minutes late.",
        remaining: 4.2,
      },
    },
  };
  try {
    const meshCount = () => {
      let count = 0;
      hud.scene.traverse(object => { count += Number(object.isMesh); });
      return count;
    };
    const countBefore = meshCount();
    hud.update(base);
    const group = hud.scene.getObjectByName("Night Shift Stories fixed fare conversation card");
    const backdrop = hud.scene.getObjectByName("Night Shift Stories opaque black conversation backdrop");
    const heading = hud.scene.getObjectByName("Night Shift Stories passenger and role");
    const body = hud.scene.getObjectByName("Night Shift Stories two-line passenger dialogue");
    assert.ok(group?.visible);
    assert.ok(backdrop?.userData.hudBackdrop, "the passenger line needs the proven transparent-black backing texture");
    assert.ok(heading.renderOrder > backdrop.renderOrder && body.renderOrder > backdrop.renderOrder);
    assert.match(heading.userData.text, /SAMIRA COLE.*HOME-CARE ASSISTANT/);
    assert.match(body.userData.text, /HARBOUR GATE THREE/i);
    assert.ok(body.userData.text.includes("\n"), "long fare dialogue should use the fixed two-line budget");
    assert.ok([...hud.scene.children].length > 0);
    const boarding = [];
    hud.scene.traverse(object => {
      if (object.userData?.text === "BOARDING 63%") boarding.push(object);
    });
    assert.equal(boarding.length, 1);
    assert.equal(hud.scene.getObjectByName("Neon City gameplay toast")?.visible, false,
      "a generic toast should not paint over a passenger line");
    assert.equal(hud.scene.getObjectByName("Neon City gameplay vehicle telemetry")?.visible, false,
      "the fare card should own the lower-right safe area instead of overlapping vehicle telemetry");
    assert.equal(hud.scene.getObjectByName("Neon City gameplay interaction prompt")?.visible, false,
      "a generic interaction prompt should yield while the named passenger is speaking");
    for (const retained of [
      "Neon City gameplay mission card",
      "Neon City gameplay player stats",
      "Neon City pooled square minimap",
    ]) assert.equal(hud.scene.getObjectByName(retained)?.visible, true, `${retained} should remain available during a fare line`);

    const headingGeometry = heading.geometry;
    const bodyGeometry = body.geometry;
    const headingPositions = heading.geometry.getAttribute("position").array;
    const bodyPositions = body.geometry.getAttribute("position").array;
    const bodyUvs = body.geometry.getAttribute("uv").array;
    for (const [passenger, role, text, serial] of [
      ["Tomas Okafor", "Market kitchen runner", "Pulse Street side entrance. Keep the trays level.", 2],
      ["Inez Park", "Session guitarist", "Moon Gate. The club kept us late and the night bus kept its schedule.", 3],
    ]) {
      hud.update({
        ...base,
        activity: {
          ...base.activity,
          passenger,
          passengerRole: role,
          dialogue: { ...base.activity.dialogue, serial, speaker: passenger, role, text },
        },
      });
    }
    hud.update({
      ...base,
      activity: {
        kind: "ordinary_story",
        id: "the_night_count",
        title: "THE NIGHT COUNT",
        subtitle: "WHO GETS COUNTED WHEN THE MACHINE FAILS",
        status: "active",
        phase: "survey",
        objective: "COUNT THE PULSE STATION CASH RIDERS",
        surveyIndex: 1,
        surveyCount: 4,
        targetPosition: [48, 0.04, -21.35],
        dialogue: {
          active: true,
          serial: 4,
          speaker: "Malik Reed",
          role: "Night Route driver",
          text: "Write eighteen at Pulse, including the three the validator missed.",
          remaining: 4.1,
        },
      },
    });
    assert.equal(group.visible, true, "ordinary-life dialogue should reuse the resident conversation card");
    assert.match(heading.userData.text, /MALIK REED.*NIGHT ROUTE DRIVER/);
    assert.match(body.userData.text, /WRITE EIGHTEEN AT PULSE/i);
    const storyProgress = [];
    hud.scene.traverse(object => {
      if (object.userData?.text?.startsWith("NIGHT RIDERS 1/4")) storyProgress.push(object);
    });
    assert.equal(storyProgress.length, 1, "ordinary story progress should replace an invented cash payout");
    assert.equal(meshCount(), countBefore);
    assert.strictEqual(heading.geometry, headingGeometry);
    assert.strictEqual(body.geometry, bodyGeometry);
    assert.strictEqual(heading.geometry.getAttribute("position").array, headingPositions);
    assert.strictEqual(body.geometry.getAttribute("position").array, bodyPositions);
    assert.strictEqual(body.geometry.getAttribute("uv").array, bodyUvs);

    hud.update({
      ...base,
      narrative: { active: true, cinematic: false, line: { speaker: "JUNO", text: "Authored story owns this frame." } },
    });
    assert.equal(group.visible, false, "authored story presentation must take precedence");
    hud.update({ ...base, activity: { ...base.activity, dialogue: { ...base.activity.dialogue, remaining: 0, active: false } } });
    assert.equal(group.visible, false, "an expired line should release the driving view");
    assert.equal(hud.scene.getObjectByName("Neon City gameplay vehicle telemetry")?.visible, true);
    assert.equal(hud.scene.getObjectByName("Neon City gameplay interaction prompt")?.visible, true);
    hud.update({ ...base, neighbourhood: { menuOpen: true }, activity: base.activity });
    assert.equal(group.visible, false, "the Open Doors menu remains modal");
  } finally {
    hud.dispose();
  }
});

test("Borrowed Time owns the mission card and generic moral-choice presentation", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  const textMeshes = () => {
    const result = [];
    hud.scene.traverse(object => { if (typeof object?.userData?.text === "string") result.push(object); });
    return result;
  };
  try {
    const base = {
      elapsed: 18,
      capture: { locked: true },
      player: { position: [-144, 0.2, 79.6], health: 100, stamina: 100, armor: 0, cash: 1250, alive: true },
      story: { active: false, cinematic: false },
      narrative: { active: false, cinematic: false, controlsLocked: false },
      mission: { title: "HOME AGAIN", objective: "OLD CHAPTER", status: "completed", reward: 5000 },
      chapterTwoMission: {
        kind: "story_chapter",
        title: "BORROWED TIME",
        objective: "INSPECT THE HOSE, INVOICE, AND SERVICE LOG",
        status: "active",
        targetPosition: [-151.5, 0.2, 79.6],
        hudDetail: "EVIDENCE 2/3  /  NO VIOLENCE REQUIRED",
      },
    };
    const gameplayClutterNames = [
      "Neon City gameplay player stats",
      "Neon City gameplay mission card",
      "Neon City pooled square minimap",
      "Neon City gameplay interaction prompt",
      "Neon City gameplay toast",
      "Neon City gameplay aiming reticle",
      "Neon City gameplay diagnostics",
    ];
    hud.update({
      ...base,
      player: { ...base.player, aiming: true },
      prompt: "E  PHOTOGRAPH SOUTHLINE'S MANIFEST",
      toast: "LIVE GAMEPLAY TOAST",
      toastUntil: 99,
    });
    for (const name of gameplayClutterNames) {
      assert.equal(hud.scene.getObjectByName(name)?.visible, true,
        `${name} should be present during ordinary gameplay before the authored line`);
    }
    const chapterTitle = textMeshes().find(mesh => mesh.userData.text === "BORROWED TIME");
    assert.ok(chapterTitle, "Chapter Two should replace the completed recovery card");
    assert.equal(chapterTitle.material.color.getHex(), 0xffbd62);
    assert.ok(textMeshes().some(mesh => /EVIDENCE 2\/3.*NO VIOLENCE REQUIRED/.test(mesh.userData.text)));
    const fixedDialogue = hud.scene.getObjectByName("Narrative dialogue body");
    const fixedDialogueGeometry = fixedDialogue.geometry;
    const fixedDialoguePositions = fixedDialogue.geometry.getAttribute("position").array;
    const fixedDialogueUvs = fixedDialogue.geometry.getAttribute("uv").array;
    assert.equal(fixedDialogue.geometry.getAttribute("position").usage, THREE.StaticDrawUsage);
    assert.equal(fixedDialogue.geometry.getAttribute("uv").usage, THREE.StaticDrawUsage);
    assert.notEqual(fixedDialogue.geometry.getAttribute("position").usage, THREE.DynamicDrawUsage);

    hud.update({
      ...base,
      player: { ...base.player, aiming: true },
      prompt: "E  PHOTOGRAPH SOUTHLINE'S MANIFEST",
      toast: "LIVE GAMEPLAY TOAST",
      toastUntil: 99,
      narrative: {
        active: true,
        cinematic: false,
        controlsLocked: false,
        line: {
          speaker: "KAI",
          text: "I HAVE A CLEAR PHOTO. THE SAME PALLET WENT TO THREE DISTRICTS.",
          progress: 0.42,
        },
        choice: null,
      },
    });
    assert.equal(isAuthoredNarrativePresentation({ active: true, cinematic: false, line: { text: "EVIDENCE" } }), true,
      "a gameplay-camera evidence line is still authored presentation");
    assert.ok(hud.scene.getObjectByName("Narrative dialogue card")?.visible);
    assert.equal(hud.scene.getObjectByName("Narrative cinematic letterbox")?.visible, false,
      "non-cinematic evidence dialogue should not invent letterbox bars");
    for (const name of gameplayClutterNames) {
      assert.equal(hud.scene.getObjectByName(name)?.visible, false,
        `${name} must not collide with authored evidence dialogue`);
    }
    assert.strictEqual(fixedDialogue.geometry, fixedDialogueGeometry);
    assert.strictEqual(fixedDialogue.geometry.getAttribute("position").array, fixedDialoguePositions);
    assert.strictEqual(fixedDialogue.geometry.getAttribute("uv").array, fixedDialogueUvs);

    hud.update({
      ...base,
      narrative: {
        active: true,
        cinematic: true,
        controlsLocked: true,
        line: null,
        choice: {
          prompt: "WHEN DOES KAI REPORT THE DEFECT?",
          options: [
            { label: "REPORT NOW", summary: "PUBLIC RECALL; FREEZE THE EVIDENCE; EXPOSE THE GARAGE'S PEOPLE" },
            { label: "RECALL SEVEN, THEN REPORT", summary: "PARK KNOWN CARS; RISK FOUR UNKNOWN DRIVERS AND A SIX-HOUR EVIDENCE WINDOW" },
          ],
        },
      },
    });
    assert.ok(textMeshes().some(mesh => mesh.userData.text === "DECIDE — BOTH ANSWERS HAVE A COST"));
    assert.ok(textMeshes().some(mesh => /WHEN DOES KAI REPORT THE DEFECT/.test(mesh.userData.text)));
    const dialoguePanel = hud.scene.getObjectByName("Narrative dialogue panel");
    const dialogueBody = hud.scene.getObjectByName("Narrative dialogue body");
    const dialogueCard = hud.scene.getObjectByName("Narrative dialogue card");
    assert.ok(dialoguePanel?.visible && dialogueBody?.visible);
    assert.ok(hud.scene.getObjectByName("Narrative cinematic letterbox")?.visible);
    for (const name of gameplayClutterNames) {
      assert.equal(hud.scene.getObjectByName(name)?.visible, false,
        `${name} must not collide with the moral-choice card`);
    }
    assert.strictEqual(dialogueBody.geometry, fixedDialogueGeometry);
    assert.strictEqual(dialogueBody.geometry.getAttribute("position").array, fixedDialoguePositions);
    assert.strictEqual(dialogueBody.geometry.getAttribute("uv").array, fixedDialogueUvs);
    const lines = dialogueBody.userData.text.split("\n");
    assert.equal(lines.length, 4, "the prompt and two costly options must fit the four-line dialogue budget");
    assert.match(lines[1], /^A \/ 1 REPORT NOW/);
    assert.match(lines[2], /^D \/ 2 RECALL SEVEN, THEN REPORT/);
    assert.match(lines[3], /^       /, "the long second option needs an indented continuation line");
    const position = dialogueBody.geometry.getAttribute("position").array;
    const drawnGlyphs = dialogueBody.geometry.drawRange.count / 6;
    let renderedRight = 0;
    for (let glyph = 0; glyph < drawnGlyphs; ++glyph) {
      const offset = glyph * 12;
      renderedRight = Math.max(renderedRight, position[offset], position[offset + 3], position[offset + 6], position[offset + 9]);
    }
    const safeRight = dialoguePanel.userData.width - 24;
    assert.ok(dialogueBody.position.x + renderedRight <= safeRight,
      `choice glyphs overflow the dialogue panel: ${dialogueBody.position.x + renderedRight}px > ${safeRight}px`);
    assert.equal(dialoguePanel.userData.width, 900, "the authored dialogue card has one exact prewarmed width");
    const cardLeft = dialogueCard.position.x;
    const cardRight = cardLeft + dialoguePanel.userData.width * dialogueCard.scale.x;
    const cardTop = dialogueCard.position.y;
    const cardBottom = cardTop + dialoguePanel.userData.height * dialogueCard.scale.y;
    assert.ok(cardLeft >= 15 && cardRight <= 1280 - 15,
      `choice card must stay inside the horizontal safe area: ${cardLeft}..${cardRight}`);
    assert.ok(cardTop >= 0 && cardBottom <= 720,
      `choice card must stay inside the viewport: ${cardTop}..${cardBottom}`);
  } finally {
    hud.dispose();
  }
});
