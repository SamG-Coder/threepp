const WISEMANS_FERRY_ID = "wisemans-ferry-broad-reach";
const FIRST_BRANCH_ID = "macdonald-river-first-branch";

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

export const LOCATION_IDS = deepFreeze({
  WISEMANS_FERRY_BROAD_REACH: WISEMANS_FERRY_ID,
  MACDONALD_RIVER_FIRST_BRANCH: FIRST_BRANCH_ID,
});

export const LOCATION_REGISTRY = deepFreeze({
  schemaVersion: 1,
  start: {
    locationId: WISEMANS_FERRY_ID,
    spawnId: "ferry-bank",
  },
  locations: [
    {
      id: WISEMANS_FERRY_ID,
      name: "Wisemans Ferry / Broad Reach",
      region: "Hawkesbury River",
      mapView: {
        coordinateSystem: "WGS84",
        bounds: {
          west: 150.9835,
          south: -33.3863,
          east: 150.9912,
          north: -33.3775,
        },
        origin: [150.9868024, -33.3852776],
        metresToWorld: 0.1,
      },
      source: {
        label: "Wisemans Ferry village",
        coordinateSystem: "WGS84",
        coordinate: [150.9868024, -33.3852776],
      },
      bounds: {
        minX: -96,
        maxX: 96,
        minZ: -28,
        maxZ: 170,
      },
      pathProfile: {
        id: "broad-reach-bank-v1",
        seed: 5359585,
        roadWidth: 4.4,
        playableZ: [16.2, 24.4],
        knots: [
          { x: -96, roadCenterZ: 20.25, shoreZ: 13.4, bankHeight: 1.78 },
          { x: -48, roadCenterZ: 19.55, shoreZ: 12.0, bankHeight: 1.84 },
          { x: 0, roadCenterZ: 19.85, shoreZ: 10.6, bankHeight: 1.9 },
          { x: 48, roadCenterZ: 20.35, shoreZ: 13.2, bankHeight: 1.95 },
          { x: 96, roadCenterZ: 19.1, shoreZ: 13.9, bankHeight: 1.99 },
        ],
      },
      dressingSeeds: {
        trees: 9046981,
        flora: 5435674,
      },
      defaultSpawnId: "ferry-bank",
      spawnPoints: [
        {
          id: "ferry-bank",
          label: "Wisemans Ferry village",
          position: { x: -4, z: 19.82 },
          sourceCoordinate: [150.9868024, -33.3852776],
          facing: "east",
          arrivalFromLocationId: null,
        },
        {
          id: "from-first-branch",
          label: "Public wharf return from First Branch",
          position: { x: 89, z: 19.28 },
          sourceCoordinate: [150.9892372, -33.3818903],
          facing: "west",
          arrivalFromLocationId: FIRST_BRANCH_ID,
        },
      ],
      objectives: [
        {
          id: "survey-broad-reach",
          order: 0,
          title: "Survey Broad Reach",
          prompt: "Follow the ferry-side bank to the eastern bend.",
          requiredObjectiveIds: [],
          completion: {
            kind: "reach",
            position: { x: 72, z: 19.72 },
            sourceCoordinate: [150.9892372, -33.3818903],
            radius: 5,
          },
        },
      ],
      exits: [
        {
          id: "east-bank-to-first-branch",
          label: "Continue into First Branch",
          reciprocalExitId: "west-bank-to-broad-reach",
          trigger: {
            axis: "x",
            comparison: ">=",
            value: 94,
            direction: 1,
            zRange: [16.2, 24.4],
            sourceCoordinate: [150.989, -33.3793],
          },
          destination: {
            locationId: FIRST_BRANCH_ID,
            spawnId: "from-broad-reach",
          },
          requiredObjectiveIds: ["survey-broad-reach"],
        },
      ],
    },
    {
      id: FIRST_BRANCH_ID,
      name: "Macdonald River / First Branch",
      region: "Macdonald River",
      mapView: {
        coordinateSystem: "WGS84",
        bounds: {
          west: 150.9828,
          south: -33.3804,
          east: 150.9898,
          north: -33.3738,
        },
        origin: [150.984994, -33.3783594],
        metresToWorld: 0.1,
      },
      source: {
        label: "Macdonald River · First Branch",
        coordinateSystem: "WGS84",
        coordinate: [150.984994, -33.3783594],
      },
      bounds: {
        minX: -96,
        maxX: 96,
        minZ: -28,
        maxZ: 170,
      },
      pathProfile: {
        id: "first-branch-bank-v1",
        seed: 1296122692,
        roadWidth: 4.1,
        playableZ: [16.4, 24.8],
        knots: [
          { x: -96, roadCenterZ: 20.8, shoreZ: 14.0, bankHeight: 1.7 },
          { x: -52, roadCenterZ: 21.4, shoreZ: 12.6, bankHeight: 1.76 },
          { x: -8, roadCenterZ: 20.7, shoreZ: 11.4, bankHeight: 1.82 },
          { x: 40, roadCenterZ: 19.9, shoreZ: 10.2, bankHeight: 1.88 },
          { x: 96, roadCenterZ: 20.5, shoreZ: 13.1, bankHeight: 1.93 },
        ],
      },
      dressingSeeds: {
        trees: 2037682,
        flora: 11325681,
      },
      defaultSpawnId: "from-broad-reach",
      spawnPoints: [
        {
          id: "from-broad-reach",
          label: "Macdonald River confluence",
          position: { x: -89, z: 20.92 },
          sourceCoordinate: [150.984994, -33.3783594],
          facing: "east",
          arrivalFromLocationId: WISEMANS_FERRY_ID,
        },
        {
          id: "first-branch-camp",
          label: "Thomas James Bridge bank",
          position: { x: 8, z: 20.43 },
          sourceCoordinate: [150.9857723, -33.3755297],
          facing: "west",
          arrivalFromLocationId: null,
        },
      ],
      objectives: [
        {
          id: "trace-first-branch",
          order: 0,
          title: "Trace First Branch",
          prompt: "Follow the narrower bank and inspect the upstream crossing.",
          requiredObjectiveIds: ["survey-broad-reach"],
          completion: {
            kind: "reach",
            position: { x: 70, z: 20.15 },
            sourceCoordinate: [150.9857723, -33.3755297],
            radius: 5,
          },
        },
      ],
      exits: [
        {
          id: "west-bank-to-broad-reach",
          label: "Return to Broad Reach",
          reciprocalExitId: "east-bank-to-first-branch",
          trigger: {
            axis: "x",
            comparison: "<=",
            value: -94,
            direction: -1,
            zRange: [16.4, 24.8],
            sourceCoordinate: [150.984994, -33.3783594],
          },
          destination: {
            locationId: WISEMANS_FERRY_ID,
            spawnId: "from-first-branch",
          },
          requiredObjectiveIds: ["trace-first-branch"],
        },
      ],
    },
  ],
});

export const START_LOCATION_ID = LOCATION_REGISTRY.start.locationId;
