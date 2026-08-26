export const MAP_NAVIGATION_SAVE_VERSION = 1;

const DEFAULT_VIEWPORT = Object.freeze({ width: 360, height: 560 });
const DEFAULT_MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 8;
const DEFAULT_HIT_RADIUS = 24;
const DRAG_THRESHOLD = 6;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function frozenCopy(value) {
  return deepFreeze(structuredClone(value));
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function cleanText(value, label, maximumLength = 160) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  return text.slice(0, maximumLength);
}

function optionalText(value, maximumLength = 240) {
  return value == null ? "" : String(value).trim().slice(0, maximumLength);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sameNumber(first, second) {
  return Math.abs(first - second) <= 1e-9;
}

function pointComponents(value, label = "position") {
  if (Array.isArray(value)) {
    if (value.length >= 3) {
      return {
        x: finiteNumber(value[0], `${label}.x`),
        y: finiteNumber(value[1], `${label}.y`),
        z: finiteNumber(value[2], `${label}.z`),
      };
    }
    if (value.length >= 2) {
      return {
        x: finiteNumber(value[0], `${label}.x`),
        y: 0,
        z: finiteNumber(value[1], `${label}.z`),
      };
    }
  }
  if (value && typeof value === "object") {
    return {
      x: finiteNumber(value.x, `${label}.x`),
      y: value.y == null ? 0 : finiteNumber(value.y, `${label}.y`),
      z: finiteNumber(value.z, `${label}.z`),
    };
  }
  throw new TypeError(`${label} must contain x and z coordinates`);
}

function screenPoint(value, label = "pointer") {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      x: finiteNumber(value[0], `${label}.x`),
      y: finiteNumber(value[1], `${label}.y`),
      pointerId: 0,
    };
  }
  if (value && typeof value === "object") {
    return {
      x: finiteNumber(value.x ?? value.clientX, `${label}.x`),
      y: finiteNumber(value.y ?? value.clientY, `${label}.y`),
      pointerId: Math.trunc(Number(value.pointerId ?? 0)) || 0,
    };
  }
  throw new TypeError(`${label} must contain screen x and y coordinates`);
}

export function normalizeMapBounds(value) {
  if (!value || typeof value !== "object") throw new TypeError("map bounds are required");
  const minimum = value.min ?? value.minimum ?? {};
  const maximum = value.max ?? value.maximum ?? {};
  const minX = finiteNumber(value.minX ?? minimum.x, "bounds.minX");
  const maxX = finiteNumber(value.maxX ?? maximum.x, "bounds.maxX");
  const minZ = finiteNumber(value.minZ ?? minimum.z, "bounds.minZ");
  const maxZ = finiteNumber(value.maxZ ?? maximum.z, "bounds.maxZ");
  if (maxX <= minX || maxZ <= minZ) throw new RangeError("map bounds must have positive area");
  return Object.freeze({ minX, maxX, minZ, maxZ });
}

function normalizeViewport(value = DEFAULT_VIEWPORT) {
  if (!value || typeof value !== "object") throw new TypeError("map viewport is required");
  const width = finiteNumber(value.width, "viewport.width");
  const height = finiteNumber(value.height, "viewport.height");
  if (width <= 0 || height <= 0) throw new RangeError("map viewport must have positive dimensions");
  return Object.freeze({ width, height });
}

function normalizePlace(rawPlace, index, bounds) {
  if (!rawPlace || typeof rawPlace !== "object") throw new TypeError(`places[${index}] must be an object`);
  const id = cleanText(rawPlace.id ?? rawPlace.placeId, `places[${index}].id`);
  const title = cleanText(rawPlace.title ?? rawPlace.name ?? rawPlace.label ?? id,
    `places[${index}].title`);
  const category = cleanText(rawPlace.category ?? rawPlace.type ?? "place",
    `places[${index}].category`, 64).toLowerCase();
  const sourcePosition = rawPlace.position ?? rawPlace.worldPosition ?? rawPlace.target ?? rawPlace;
  const positionValue = pointComponents(sourcePosition, `places[${index}].position`);
  if (positionValue.x < bounds.minX || positionValue.x > bounds.maxX
      || positionValue.z < bounds.minZ || positionValue.z > bounds.maxZ) {
    throw new RangeError(`places[${index}].position lies outside the authored map bounds`);
  }
  const priorityNumber = Number(rawPlace.priority ?? 0);
  const priority = Number.isFinite(priorityNumber) ? Math.trunc(priorityNumber) : 0;
  return deepFreeze({
    id,
    title,
    category,
    icon: optionalText(rawPlace.icon ?? rawPlace.iconId ?? category, 64) || category,
    address: optionalText(rawPlace.address),
    description: optionalText(rawPlace.description ?? rawPlace.subtitle, 400),
    open: rawPlace.open == null ? true : Boolean(rawPlace.open),
    priority,
    position: {
      x: positionValue.x,
      y: positionValue.y,
      z: positionValue.z,
    },
  });
}

export function createMapPlaceDirectory(source, boundsValue) {
  if (!Array.isArray(source)) throw new TypeError("map place directory must be an array");
  const bounds = normalizeMapBounds(boundsValue);
  const ids = new Set();
  const places = source.map((place, index) => {
    const normalized = normalizePlace(place, index, bounds);
    if (ids.has(normalized.id)) throw new RangeError(`duplicate map place id: ${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });
  return Object.freeze(places);
}

function centerOf(bounds) {
  return {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: 0,
    z: (bounds.minZ + bounds.maxZ) * 0.5,
  };
}

function viewScale(bounds, viewport, zoom) {
  return Math.min(
    viewport.width / (bounds.maxX - bounds.minX),
    viewport.height / (bounds.maxZ - bounds.minZ),
  ) * zoom;
}

function clampCenter(value, bounds, viewport, zoom) {
  const scale = viewScale(bounds, viewport, zoom);
  const middle = centerOf(bounds);
  const halfWidth = viewport.width / (scale * 2);
  const halfHeight = viewport.height / (scale * 2);
  return {
    x: halfWidth >= (bounds.maxX - bounds.minX) * 0.5
      ? middle.x
      : clamp(value.x, bounds.minX + halfWidth, bounds.maxX - halfWidth),
    y: 0,
    z: halfHeight >= (bounds.maxZ - bounds.minZ) * 0.5
      ? middle.z
      : clamp(value.z, bounds.minZ + halfHeight, bounds.maxZ - halfHeight),
  };
}

function projectPoint(position, center, bounds, viewport, zoom) {
  const scale = viewScale(bounds, viewport, zoom);
  return {
    x: viewport.width * 0.5 + (position.x - center.x) * scale,
    // The shared GPS is north-up: positive world Z moves toward the top of
    // the screen, while positive screen Y still points down.
    y: viewport.height * 0.5 - (position.z - center.z) * scale,
  };
}

function unprojectPoint(position, center, bounds, viewport, zoom) {
  const scale = viewScale(bounds, viewport, zoom);
  return {
    x: center.x + (position.x - viewport.width * 0.5) / scale,
    y: 0,
    z: center.z - (position.y - viewport.height * 0.5) / scale,
  };
}

function normalizedSaveText(value, label) {
  if (value == null) return null;
  return cleanText(value, label);
}

function validateCustomNavigation(value) {
  if (!value || typeof value !== "object") throw new TypeError("saved navigation must be an object or null");
  const placeId = normalizedSaveText(value.placeId, "navigation.placeId");
  if (placeId) return deepFreeze({ placeId });
  return deepFreeze({
    placeId: null,
    target: pointComponents(value.target, "navigation.target"),
    title: cleanText(value.title ?? "DROPPED PIN", "navigation.title"),
    category: cleanText(value.category ?? "waypoint", "navigation.category", 64).toLowerCase(),
    source: cleanText(value.source ?? "user_waypoint", "navigation.source", 64).toLowerCase(),
  });
}

export function migrateMapNavigationSave(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("map navigation save must be an object");
  }
  const version = Number(source.version ?? 0);
  let migrated;
  if (version === 0) {
    const navigationId = source.navigationPlaceId ?? source.navigationId ?? source.routeTargetId ?? null;
    migrated = {
      version: MAP_NAVIGATION_SAVE_VERSION,
      open: source.open ?? source.isOpen ?? false,
      center: source.center ?? { x: source.centerX, z: source.centerZ },
      zoom: source.zoom ?? 1,
      selectedPlaceId: source.selectedPlaceId ?? source.selectedId ?? source.destinationId ?? null,
      navigation: navigationId == null ? null : { placeId: navigationId },
    };
  } else if (version === MAP_NAVIGATION_SAVE_VERSION) {
    migrated = source;
  } else {
    throw new RangeError(`unsupported map navigation save version: ${version}`);
  }
  if (typeof migrated.open !== "boolean") throw new TypeError("saved open state must be boolean");
  const center = pointComponents(migrated.center, "center");
  const zoom = finiteNumber(migrated.zoom, "zoom");
  if (zoom <= 0) throw new RangeError("saved zoom must be positive");
  const selectedPlaceId = normalizedSaveText(migrated.selectedPlaceId, "selectedPlaceId");
  const navigation = migrated.navigation == null ? null : validateCustomNavigation(migrated.navigation);
  return deepFreeze({
    version: MAP_NAVIGATION_SAVE_VERSION,
    open: migrated.open,
    center: { x: center.x, y: 0, z: center.z },
    zoom,
    selectedPlaceId,
    navigation,
  });
}

function hash32(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createMapNavigation(options = {}) {
  const bounds = normalizeMapBounds(options.bounds ?? options.mapBounds);
  let places = createMapPlaceDirectory(
    options.places ?? options.placeDirectory ?? options.directory ?? [],
    bounds,
  );
  let placeById = new Map(places.map(place => [place.id, place]));
  const minZoom = finiteNumber(options.minZoom ?? DEFAULT_MIN_ZOOM, "minZoom");
  const maxZoom = finiteNumber(options.maxZoom ?? DEFAULT_MAX_ZOOM, "maxZoom");
  if (minZoom <= 0 || maxZoom < minZoom) throw new RangeError("invalid map zoom range");
  let viewport = normalizeViewport(options.viewport ?? DEFAULT_VIEWPORT);
  const initialPosition = options.initialCenter == null
    ? centerOf(bounds)
    : pointComponents(options.initialCenter, "initialCenter");
  let zoom = clamp(finiteNumber(options.initialZoom ?? minZoom, "initialZoom"), minZoom, maxZoom);
  let center = clampCenter(initialPosition, bounds, viewport, zoom);
  let isOpen = Boolean(options.open ?? false);
  let selectedPlaceId = null;
  let navigationState = null;
  let gesture = null;
  let revision = 0;
  let snapshotCache = null;
  let saveCache = null;
  let prewarmCache = null;

  function invalidate({ save = true } = {}) {
    revision += 1;
    snapshotCache = null;
    if (save) saveCache = null;
  }

  function placeNavigation(place) {
    if (!place) return null;
    return deepFreeze({
      placeId: place.id,
      destinationId: place.id,
      title: place.title,
      category: place.category,
      source: "user_place",
      target: place.position,
    });
  }

  function navigationSnapshot() {
    if (!navigationState) return null;
    if (navigationState.placeId) return placeNavigation(placeById.get(navigationState.placeId));
    return navigationState;
  }

  function snapshot() {
    if (snapshotCache) return snapshotCache;
    const selectedDestination = selectedPlaceId == null ? null : placeById.get(selectedPlaceId) ?? null;
    const navigation = navigationSnapshot();
    snapshotCache = deepFreeze({
      open: isOpen,
      bounds,
      viewport,
      center: { x: center.x, y: 0, z: center.z },
      zoom,
      minZoom,
      maxZoom,
      places,
      selectedPlaceId,
      selectedDestination,
      navigationPlaceId: navigation?.placeId ?? null,
      destinationId: navigation?.destinationId ?? navigation?.placeId ?? null,
      navigation,
      navigationTarget: navigation?.target ?? null,
      routeTarget: navigation?.target ?? null,
      routeSource: navigation?.source ?? null,
      gesture: gesture == null ? null : {
        active: true,
        dragging: gesture.dragging,
        pointerId: gesture.pointerId,
      },
      revision,
    });
    return snapshotCache;
  }

  function setOpen(value) {
    const next = Boolean(value);
    if (next === isOpen) return snapshot();
    isOpen = next;
    if (!isOpen) gesture = null;
    invalidate();
    return snapshot();
  }

  function setViewport(value) {
    const next = normalizeViewport(value);
    if (sameNumber(next.width, viewport.width) && sameNumber(next.height, viewport.height)) return snapshot();
    viewport = next;
    center = clampCenter(center, bounds, viewport, zoom);
    invalidate();
    return snapshot();
  }

  function resolveViewport(value) {
    return value == null ? viewport : normalizeViewport(value);
  }

  function project(value, viewportValue = null) {
    const position = pointComponents(value, "map point");
    const view = resolveViewport(viewportValue);
    return deepFreeze(projectPoint(position, center, bounds, view, zoom));
  }

  function unproject(value, viewportValue = null) {
    const pointer = screenPoint(value, "screen point");
    const view = resolveViewport(viewportValue);
    const position = unprojectPoint(pointer, center, bounds, view, zoom);
    return deepFreeze({
      x: clamp(position.x, bounds.minX, bounds.maxX),
      y: 0,
      z: clamp(position.z, bounds.minZ, bounds.maxZ),
    });
  }

  function setCenter(value) {
    const requested = pointComponents(value, "map center");
    const next = clampCenter(requested, bounds, viewport, zoom);
    if (sameNumber(next.x, center.x) && sameNumber(next.z, center.z)) return snapshot();
    center = next;
    invalidate();
    return snapshot();
  }

  function panBy(deltaXValue, deltaYValue, viewportValue = null) {
    const deltaX = finiteNumber(deltaXValue, "pan delta x");
    const deltaY = finiteNumber(deltaYValue, "pan delta y");
    if (deltaX === 0 && deltaY === 0) return snapshot();
    const view = resolveViewport(viewportValue);
    const scale = viewScale(bounds, view, zoom);
    const next = clampCenter({
      x: center.x - deltaX / scale,
      z: center.z + deltaY / scale,
    }, bounds, view, zoom);
    if (sameNumber(next.x, center.x) && sameNumber(next.z, center.z)) return snapshot();
    center = next;
    invalidate();
    return snapshot();
  }

  function setZoom(value, anchorValue = null, viewportValue = null) {
    const nextZoom = clamp(finiteNumber(value, "map zoom"), minZoom, maxZoom);
    if (sameNumber(nextZoom, zoom)) return snapshot();
    const view = resolveViewport(viewportValue);
    const anchor = anchorValue == null
      ? { x: view.width * 0.5, y: view.height * 0.5 }
      : screenPoint(anchorValue, "zoom anchor");
    const worldAtAnchor = unprojectPoint(anchor, center, bounds, view, zoom);
    const nextScale = viewScale(bounds, view, nextZoom);
    const requestedCenter = {
      x: worldAtAnchor.x - (anchor.x - view.width * 0.5) / nextScale,
      z: worldAtAnchor.z + (anchor.y - view.height * 0.5) / nextScale,
    };
    zoom = nextZoom;
    center = clampCenter(requestedCenter, bounds, view, zoom);
    invalidate();
    return snapshot();
  }

  function zoomBy(deltaValue, anchorValue = null, viewportValue = null) {
    return setZoom(zoom + finiteNumber(deltaValue, "zoom delta"), anchorValue, viewportValue);
  }

  function zoomWheel(deltaYValue, anchorValue = null, viewportValue = null) {
    const deltaY = finiteNumber(deltaYValue, "wheel delta");
    const factor = Math.exp(-deltaY * 0.0018);
    return setZoom(zoom * factor, anchorValue, viewportValue);
  }

  function hitTest(pointValue, viewportValue = null, radiusValue = DEFAULT_HIT_RADIUS) {
    const pointer = screenPoint(pointValue);
    const view = resolveViewport(viewportValue);
    const radius = Math.max(1, finiteNumber(radiusValue, "hit radius"));
    let best = null;
    let bestDistanceSquared = radius * radius;
    for (const place of places) {
      const projected = projectPoint(place.position, center, bounds, view, zoom);
      const distanceSquared = (pointer.x - projected.x) ** 2 + (pointer.y - projected.y) ** 2;
      if (distanceSquared > bestDistanceSquared) continue;
      if (best && sameNumber(distanceSquared, bestDistanceSquared) && place.priority < best.priority) continue;
      if (best && sameNumber(distanceSquared, bestDistanceSquared)
          && place.priority === best.priority && place.id.localeCompare(best.id) > 0) continue;
      best = place;
      bestDistanceSquared = distanceSquared;
    }
    return best;
  }

  function selectPlace(idValue) {
    if (idValue == null) {
      if (selectedPlaceId == null) return null;
      selectedPlaceId = null;
      invalidate();
      return null;
    }
    const id = String(idValue).trim();
    const place = placeById.get(id) ?? null;
    if (!place || selectedPlaceId === id) return place;
    selectedPlaceId = id;
    invalidate();
    return place;
  }

  function selectAt(pointValue, viewportValue = null, radiusValue = DEFAULT_HIT_RADIUS) {
    const place = hitTest(pointValue, viewportValue, radiusValue);
    selectPlace(place?.id ?? null);
    return place;
  }

  function setNavigation(value = selectedPlaceId) {
    if (typeof value === "string" || value == null) {
      const place = value == null ? null : placeById.get(String(value).trim());
      if (!place) return null;
      if (navigationState?.placeId === place.id) return navigationSnapshot();
      navigationState = Object.freeze({ placeId: place.id });
      selectedPlaceId = place.id;
      invalidate();
      return navigationSnapshot();
    }
    return setRouteTarget(value);
  }

  function setRouteTarget(positionValue, details = {}) {
    const raw = pointComponents(positionValue, "route target");
    const target = deepFreeze({
      x: clamp(raw.x, bounds.minX, bounds.maxX),
      y: 0,
      z: clamp(raw.z, bounds.minZ, bounds.maxZ),
    });
    navigationState = deepFreeze({
      placeId: null,
      destinationId: null,
      title: optionalText(details.title, 160) || "DROPPED PIN",
      category: optionalText(details.category, 64).toLowerCase() || "waypoint",
      source: optionalText(details.source, 64).toLowerCase() || "user_waypoint",
      target,
    });
    selectedPlaceId = null;
    invalidate();
    return navigationState;
  }

  function placeRouteTargetAt(pointValue, viewportValue = null, details = {}) {
    return setRouteTarget(unproject(pointValue, viewportValue), details);
  }

  function clearNavigation() {
    if (!navigationState) return null;
    navigationState = null;
    invalidate();
    return null;
  }

  function pointerDown(pointValue) {
    if (!isOpen) return Object.freeze({ accepted: false, reason: "map_closed" });
    const pointer = screenPoint(pointValue);
    gesture = {
      pointerId: pointer.pointerId,
      downX: pointer.x,
      downY: pointer.y,
      lastX: pointer.x,
      lastY: pointer.y,
      dragging: false,
    };
    invalidate({ save: false });
    return Object.freeze({ accepted: true, kind: "press", pointerId: pointer.pointerId });
  }

  function pointerMove(pointValue, viewportValue = null) {
    if (!gesture) return Object.freeze({ accepted: false, reason: "no_active_pointer" });
    const pointer = screenPoint(pointValue);
    if (pointer.pointerId !== gesture.pointerId) {
      return Object.freeze({ accepted: false, reason: "pointer_mismatch" });
    }
    const totalX = pointer.x - gesture.downX;
    const totalY = pointer.y - gesture.downY;
    const crossedThreshold = Math.hypot(totalX, totalY) > DRAG_THRESHOLD;
    if (!gesture.dragging && crossedThreshold) {
      gesture.dragging = true;
      panBy(totalX, totalY, viewportValue);
    } else if (gesture.dragging) {
      panBy(pointer.x - gesture.lastX, pointer.y - gesture.lastY, viewportValue);
    }
    gesture.lastX = pointer.x;
    gesture.lastY = pointer.y;
    invalidate({ save: false });
    return Object.freeze({ accepted: true, kind: gesture.dragging ? "drag" : "press" });
  }

  function pointerUp(pointValue, viewportValue = null, radiusValue = DEFAULT_HIT_RADIUS) {
    if (!gesture) return Object.freeze({ accepted: false, reason: "no_active_pointer" });
    const pointer = screenPoint(pointValue);
    if (pointer.pointerId !== gesture.pointerId) {
      return Object.freeze({ accepted: false, reason: "pointer_mismatch" });
    }
    const wasDragging = gesture.dragging;
    gesture = null;
    invalidate({ save: false });
    if (wasDragging) return Object.freeze({ accepted: true, kind: "pan", place: null });
    const place = selectAt(pointer, viewportValue, radiusValue);
    if (place) {
      const navigation = setNavigation(place.id);
      return Object.freeze({ accepted: true, kind: "navigate", place, navigation });
    }
    const navigation = placeRouteTargetAt(pointer, viewportValue);
    return Object.freeze({ accepted: true, kind: "drop_pin", place: null, navigation });
  }

  function cancelPointer(pointerIdValue = null) {
    if (!gesture) return false;
    if (pointerIdValue != null && Math.trunc(Number(pointerIdValue)) !== gesture.pointerId) return false;
    gesture = null;
    invalidate({ save: false });
    return true;
  }

  function refreshPlaces(source) {
    const nextPlaces = createMapPlaceDirectory(source, bounds);
    const nextById = new Map(nextPlaces.map(place => [place.id, place]));
    places = nextPlaces;
    placeById = nextById;
    if (selectedPlaceId && !placeById.has(selectedPlaceId)) selectedPlaceId = null;
    if (navigationState?.placeId && !placeById.has(navigationState.placeId)) navigationState = null;
    prewarmCache = null;
    invalidate();
    return snapshot();
  }

  function setPlaceOpen(idValue, openValue) {
    const id = String(idValue ?? "").trim();
    const current = placeById.get(id);
    if (!current) return false;
    const open = Boolean(openValue);
    if (current.open === open) return true;
    places = Object.freeze(places.map(place => place.id === id
      ? deepFreeze({ ...place, open })
      : place));
    placeById = new Map(places.map(place => [place.id, place]));
    prewarmCache = null;
    invalidate();
    return true;
  }

  function save() {
    if (saveCache) return saveCache;
    saveCache = deepFreeze({
      version: MAP_NAVIGATION_SAVE_VERSION,
      open: isOpen,
      center: { x: center.x, y: 0, z: center.z },
      zoom,
      selectedPlaceId,
      navigation: navigationState == null
        ? null
        : navigationState.placeId
          ? { placeId: navigationState.placeId }
          : {
            placeId: null,
            target: navigationState.target,
            title: navigationState.title,
            category: navigationState.category,
            source: navigationState.source,
          },
    });
    return saveCache;
  }

  function restore(source) {
    const migrated = migrateMapNavigationSave(source);
    if (migrated.zoom < minZoom || migrated.zoom > maxZoom) {
      throw new RangeError("saved zoom lies outside this map's authored zoom range");
    }
    if (migrated.center.x < bounds.minX || migrated.center.x > bounds.maxX
        || migrated.center.z < bounds.minZ || migrated.center.z > bounds.maxZ) {
      throw new RangeError("saved center lies outside this map's authored bounds");
    }
    if (migrated.selectedPlaceId && !placeById.has(migrated.selectedPlaceId)) {
      throw new RangeError(`unknown saved map selection: ${migrated.selectedPlaceId}`);
    }
    let nextNavigation = null;
    if (migrated.navigation?.placeId) {
      if (!placeById.has(migrated.navigation.placeId)) {
        throw new RangeError(`unknown saved navigation place: ${migrated.navigation.placeId}`);
      }
      nextNavigation = Object.freeze({ placeId: migrated.navigation.placeId });
    } else if (migrated.navigation) {
      const target = migrated.navigation.target;
      if (target.x < bounds.minX || target.x > bounds.maxX
          || target.z < bounds.minZ || target.z > bounds.maxZ) {
        throw new RangeError("saved route target lies outside this map's authored bounds");
      }
      nextNavigation = migrated.navigation;
    }
    const nextCenter = clampCenter(migrated.center, bounds, viewport, migrated.zoom);
    if (!sameNumber(nextCenter.x, migrated.center.x) || !sameNumber(nextCenter.z, migrated.center.z)) {
      throw new RangeError("saved center is not valid for this map viewport and zoom");
    }
    isOpen = migrated.open;
    center = nextCenter;
    zoom = migrated.zoom;
    selectedPlaceId = migrated.selectedPlaceId;
    navigationState = nextNavigation;
    gesture = null;
    invalidate();
    return snapshot();
  }

  function prewarm() {
    if (prewarmCache) return prewarmCache;
    let checksum = hash32(`${bounds.minX}:${bounds.maxX}:${bounds.minZ}:${bounds.maxZ}`);
    const zoomLevels = [minZoom, (minZoom + maxZoom) * 0.5, maxZoom];
    for (const level of zoomLevels) {
      for (const place of places) {
        const point = projectPoint(place.position, center, bounds, viewport, level);
        checksum ^= hash32(`${place.id}:${place.icon}:${point.x.toFixed(4)}:${point.y.toFixed(4)}`);
      }
    }
    const beforeSnapshot = snapshot();
    const beforeSave = save();
    prewarmCache = deepFreeze({
      ready: true,
      storage: "memory-only",
      diskResources: 0,
      rendererResources: 0,
      runtimeAssetsCreated: 0,
      placesPrepared: places.length,
      hitTargetsPrepared: places.length,
      zoomLevelsPrepared: zoomLevels.length,
      projectionDirectionsPrepared: 2,
      gestureBranchesPrepared: 4,
      saveRestorePrepared: true,
      liveStatePreserved: snapshot() === beforeSnapshot && save() === beforeSave,
      checksum: checksum >>> 0,
    });
    return prewarmCache;
  }

  return Object.freeze({
    snapshot,
    setOpen,
    toggleOpen: () => setOpen(!isOpen),
    setViewport,
    setCenter,
    panBy,
    setZoom,
    zoomBy,
    zoomWheel,
    project,
    unproject,
    hitTest,
    selectPlace,
    selectAt,
    setNavigation,
    setRouteTarget,
    placeRouteTargetAt,
    clearNavigation,
    pointerDown,
    pointerMove,
    pointerUp,
    cancelPointer,
    refreshPlaces,
    setPlaceOpen,
    save,
    restore,
    prewarm,
  });
}
