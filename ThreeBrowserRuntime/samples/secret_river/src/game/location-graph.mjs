function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isWgs84Coordinate(value) {
  return Array.isArray(value)
    && value.length === 2
    && isFiniteNumber(value[0])
    && isFiniteNumber(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function coordinateInMapView(coordinate, mapView) {
  const bounds = mapView?.bounds;
  return isWgs84Coordinate(coordinate)
    && isRecord(bounds)
    && coordinate[0] >= bounds.west
    && coordinate[0] <= bounds.east
    && coordinate[1] >= bounds.south
    && coordinate[1] <= bounds.north;
}

function hasUniqueIds(items) {
  return new Set(items.map((item) => item?.id)).size === items.length;
}

function completedObjectiveSet(progress) {
  return new Set(Array.isArray(progress?.completedObjectiveIds) ? progress.completedObjectiveIds : []);
}

function missingObjectiveIds(requiredObjectiveIds, progress) {
  const completed = completedObjectiveSet(progress);
  return (requiredObjectiveIds ?? []).filter((id) => !completed.has(id));
}

function freezeProgress(progress) {
  return deepFreeze({
    schemaVersion: progress.schemaVersion,
    currentLocationId: progress.currentLocationId,
    currentSpawnId: progress.currentSpawnId,
    visitedLocationIds: [...progress.visitedLocationIds],
    completedObjectiveIds: [...progress.completedObjectiveIds],
  });
}

function failure(reason, progress, details = {}) {
  return Object.freeze({
    ok: false,
    reason,
    ...details,
    progress,
  });
}

export function getLocation(registry, locationId) {
  return registry?.locations?.find((location) => location.id === locationId) ?? null;
}

export function getSpawnPoint(location, spawnId = location?.defaultSpawnId) {
  return location?.spawnPoints?.find((spawn) => spawn.id === spawnId) ?? null;
}

export function getLocationExit(location, exitId) {
  return location?.exits?.find((exit) => exit.id === exitId) ?? null;
}

export function getLocationObjective(location, objectiveId) {
  return location?.objectives?.find((objective) => objective.id === objectiveId) ?? null;
}

export function validateLocationRegistry(registry) {
  const errors = [];

  if (!isRecord(registry)) {
    return deepFreeze({ valid: false, errors: ["registry must be an object"] });
  }

  if (!Number.isInteger(registry.schemaVersion) || registry.schemaVersion < 1) {
    errors.push("registry.schemaVersion must be a positive integer");
  }

  if (!Array.isArray(registry.locations) || registry.locations.length === 0) {
    errors.push("registry.locations must be a non-empty array");
    return deepFreeze({ valid: false, errors });
  }

  if (!hasUniqueIds(registry.locations) || registry.locations.some((location) => !location?.id)) {
    errors.push("location ids must be present and unique");
  }

  const locationIds = new Set(registry.locations.map((location) => location?.id));
  const objectiveIds = new Set();

  for (const location of registry.locations) {
    const prefix = `location ${location?.id ?? "<missing>"}`;

    if (typeof location?.name !== "string" || location.name.length === 0) {
      errors.push(`${prefix} must have a name`);
    }

    const coordinate = location?.source?.coordinate;
    if (location?.source?.coordinateSystem !== "WGS84" || !isWgs84Coordinate(coordinate)) {
      errors.push(`${prefix} must have a valid WGS84 source coordinate`);
    }

    const mapView = location?.mapView;
    const mapBounds = mapView?.bounds;
    if (
      mapView?.coordinateSystem !== "WGS84"
      || !isRecord(mapBounds)
      || !isFiniteNumber(mapBounds.west)
      || !isFiniteNumber(mapBounds.south)
      || !isFiniteNumber(mapBounds.east)
      || !isFiniteNumber(mapBounds.north)
      || mapBounds.west >= mapBounds.east
      || mapBounds.south >= mapBounds.north
      || !isWgs84Coordinate(mapView?.origin)
      || !isFiniteNumber(mapView?.metresToWorld)
      || mapView.metresToWorld <= 0
    ) {
      errors.push(`${prefix} must have a valid WGS84 mapView`);
    } else {
      if (!coordinateInMapView(mapView.origin, mapView)) {
        errors.push(`${prefix} mapView origin must be inside its bounds`);
      }
      if (isWgs84Coordinate(coordinate) && !coordinateInMapView(coordinate, mapView)) {
        errors.push(`${prefix} source coordinate must be inside its mapView`);
      }
    }

    const bounds = location?.bounds;
    if (
      !isRecord(bounds) ||
      !isFiniteNumber(bounds.minX) ||
      !isFiniteNumber(bounds.maxX) ||
      !isFiniteNumber(bounds.minZ) ||
      !isFiniteNumber(bounds.maxZ) ||
      bounds.minX >= bounds.maxX ||
      bounds.minZ >= bounds.maxZ
    ) {
      errors.push(`${prefix} must have ordered numeric bounds`);
    }

    const profile = location?.pathProfile;
    const knots = profile?.knots;
    if (!Number.isInteger(profile?.seed) || profile.seed < 0) {
      errors.push(`${prefix} pathProfile.seed must be a non-negative integer`);
    }
    if (!Array.isArray(knots) || knots.length < 2) {
      errors.push(`${prefix} pathProfile.knots must contain at least two knots`);
    } else {
      for (let index = 0; index < knots.length; index += 1) {
        const knot = knots[index];
        if (
          !isFiniteNumber(knot?.x) ||
          !isFiniteNumber(knot?.roadCenterZ) ||
          !isFiniteNumber(knot?.shoreZ) ||
          !isFiniteNumber(knot?.bankHeight)
        ) {
          errors.push(`${prefix} pathProfile knot ${index} must contain finite numeric values`);
        }
        if (index > 0 && knot?.x <= knots[index - 1]?.x) {
          errors.push(`${prefix} pathProfile knot x values must be strictly increasing`);
        }
      }
    }

    const spawns = location?.spawnPoints;
    if (!Array.isArray(spawns) || spawns.length === 0 || !hasUniqueIds(spawns)) {
      errors.push(`${prefix} spawn point ids must be present and unique`);
    } else {
      for (const spawn of spawns) {
        if (
          !spawn?.id ||
          !isFiniteNumber(spawn?.position?.x) ||
          !isFiniteNumber(spawn?.position?.z)
        ) {
          errors.push(`${prefix} spawn points must have ids and numeric positions`);
        }
        if (!coordinateInMapView(spawn?.sourceCoordinate, mapView)) {
          errors.push(`${prefix} spawn ${spawn?.id ?? "<missing>"} must have a sourceCoordinate inside its mapView`);
        }
      }
      if (!getSpawnPoint(location, location.defaultSpawnId)) {
        errors.push(`${prefix} defaultSpawnId must reference a spawn point`);
      }
    }

    const objectives = location?.objectives;
    if (!Array.isArray(objectives) || !hasUniqueIds(objectives)) {
      errors.push(`${prefix} objective ids must be unique`);
    } else {
      for (const objective of objectives) {
        if (!objective?.id) {
          errors.push(`${prefix} objectives must have ids`);
        } else if (objectiveIds.has(objective.id)) {
          errors.push(`objective id ${objective.id} must be globally unique`);
        } else {
          objectiveIds.add(objective.id);
        }
        if (!Array.isArray(objective?.requiredObjectiveIds)) {
          errors.push(`${prefix} objective ${objective?.id ?? "<missing>"} must declare requiredObjectiveIds`);
        }
        if (!coordinateInMapView(objective?.completion?.sourceCoordinate, mapView)) {
          errors.push(`${prefix} objective ${objective?.id ?? "<missing>"} must have a sourceCoordinate inside its mapView`);
        }
      }
    }

    const exits = location?.exits;
    if (!Array.isArray(exits) || !hasUniqueIds(exits)) {
      errors.push(`${prefix} exit ids must be unique`);
    } else {
      for (const exit of exits) {
        if (!exit?.id) {
          errors.push(`${prefix} exits must have ids`);
        }
        if (!Array.isArray(exit?.requiredObjectiveIds)) {
          errors.push(`${prefix} exit ${exit?.id ?? "<missing>"} must declare requiredObjectiveIds`);
        }
        if (!locationIds.has(exit?.destination?.locationId)) {
          errors.push(`${prefix} exit ${exit?.id ?? "<missing>"} has an unknown destination location`);
        }
        const trigger = exit?.trigger;
        if (
          trigger?.axis !== "x" ||
          ![">=", "<="].includes(trigger?.comparison) ||
          !isFiniteNumber(trigger?.value) ||
          ![-1, 1].includes(trigger?.direction) ||
          !Array.isArray(trigger?.zRange) ||
          trigger.zRange.length !== 2 ||
          !isFiniteNumber(trigger.zRange[0]) ||
          !isFiniteNumber(trigger.zRange[1]) ||
          trigger.zRange[0] >= trigger.zRange[1]
        ) {
          errors.push(`${prefix} exit ${exit?.id ?? "<missing>"} has an invalid trigger`);
        }
        if (!coordinateInMapView(trigger?.sourceCoordinate, mapView)) {
          errors.push(`${prefix} exit ${exit?.id ?? "<missing>"} must have a sourceCoordinate inside its mapView`);
        }
      }
    }
  }

  for (const location of registry.locations) {
    for (const objective of location.objectives ?? []) {
      for (const requirementId of objective.requiredObjectiveIds ?? []) {
        if (!objectiveIds.has(requirementId)) {
          errors.push(`objective ${objective.id} requires unknown objective ${requirementId}`);
        }
      }
    }

    for (const exit of location.exits ?? []) {
      for (const requirementId of exit.requiredObjectiveIds ?? []) {
        if (!objectiveIds.has(requirementId)) {
          errors.push(`exit ${exit.id} requires unknown objective ${requirementId}`);
        }
      }

      const destination = getLocation(registry, exit.destination?.locationId);
      if (destination && !getSpawnPoint(destination, exit.destination?.spawnId)) {
        errors.push(`exit ${exit.id} references unknown destination spawn ${exit.destination?.spawnId}`);
      }

      const reciprocal = destination && getLocationExit(destination, exit.reciprocalExitId);
      if (!reciprocal) {
        errors.push(`exit ${exit.id} is missing reciprocal exit ${exit.reciprocalExitId}`);
      } else if (
        reciprocal.destination?.locationId !== location.id ||
        reciprocal.reciprocalExitId !== exit.id
      ) {
        errors.push(`exit ${exit.id} has a mismatched reciprocal connection`);
      }
    }
  }

  const startLocation = getLocation(registry, registry.start?.locationId);
  if (!startLocation) {
    errors.push("registry.start.locationId must reference a location");
  } else if (!getSpawnPoint(startLocation, registry.start?.spawnId)) {
    errors.push("registry.start.spawnId must reference a spawn point in the start location");
  }

  return deepFreeze({ valid: errors.length === 0, errors });
}

export function assertValidLocationRegistry(registry) {
  const result = validateLocationRegistry(registry);
  if (!result.valid) {
    throw new TypeError(`Invalid location registry:\n- ${result.errors.join("\n- ")}`);
  }
  return registry;
}

export function createLocationProgress(registry) {
  assertValidLocationRegistry(registry);
  return freezeProgress({
    schemaVersion: registry.schemaVersion,
    currentLocationId: registry.start.locationId,
    currentSpawnId: registry.start.spawnId,
    visitedLocationIds: [registry.start.locationId],
    completedObjectiveIds: [],
  });
}

export function getAvailableObjectives(registry, progress) {
  const location = getLocation(registry, progress?.currentLocationId);
  if (!location) {
    return Object.freeze([]);
  }

  const completed = completedObjectiveSet(progress);
  return Object.freeze(
    location.objectives.filter(
      (objective) =>
        !completed.has(objective.id) &&
        missingObjectiveIds(objective.requiredObjectiveIds, progress).length === 0,
    ),
  );
}

export function completeLocationObjective(registry, progress, objectiveId) {
  const location = getLocation(registry, progress?.currentLocationId);
  if (!location) {
    return failure("unknown-current-location", progress);
  }

  const objective = getLocationObjective(location, objectiveId);
  if (!objective) {
    return failure("objective-not-in-current-location", progress, { objectiveId });
  }

  const missing = missingObjectiveIds(objective.requiredObjectiveIds, progress);
  if (missing.length > 0) {
    return failure("objective-locked", progress, {
      objectiveId,
      missingObjectiveIds: Object.freeze(missing),
    });
  }

  if (completedObjectiveSet(progress).has(objectiveId)) {
    return Object.freeze({ ok: true, changed: false, objective, progress });
  }

  const nextProgress = freezeProgress({
    ...progress,
    completedObjectiveIds: [...progress.completedObjectiveIds, objectiveId],
  });

  return Object.freeze({ ok: true, changed: true, objective, progress: nextProgress });
}

export function resolveLocationTravel(registry, progress, exitId) {
  const location = getLocation(registry, progress?.currentLocationId);
  if (!location) {
    return failure("unknown-current-location", progress);
  }

  const exit = getLocationExit(location, exitId);
  if (!exit) {
    return failure("exit-not-in-current-location", progress, { exitId });
  }

  const missing = missingObjectiveIds(exit.requiredObjectiveIds, progress);
  if (missing.length > 0) {
    return failure("exit-locked", progress, {
      exitId,
      missingObjectiveIds: Object.freeze(missing),
    });
  }

  const destination = getLocation(registry, exit.destination.locationId);
  const spawn = destination && getSpawnPoint(destination, exit.destination.spawnId);
  if (!destination || !spawn) {
    return failure("invalid-exit-destination", progress, { exitId });
  }

  const visitedLocationIds = progress.visitedLocationIds.includes(destination.id)
    ? [...progress.visitedLocationIds]
    : [...progress.visitedLocationIds, destination.id];
  const nextProgress = freezeProgress({
    ...progress,
    currentLocationId: destination.id,
    currentSpawnId: spawn.id,
    visitedLocationIds,
  });
  const transition = deepFreeze({
    fromLocationId: location.id,
    exitId: exit.id,
    toLocationId: destination.id,
    spawnId: spawn.id,
    spawn: {
      position: { ...spawn.position },
      sourceCoordinate: [...spawn.sourceCoordinate],
      facing: spawn.facing,
    },
  });

  return Object.freeze({
    ok: true,
    transition,
    progress: nextProgress,
  });
}
