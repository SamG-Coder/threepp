export function createWorldState() {
  return {
    version: 1,
    elapsed: 0,
    simulationTick: 0,
    time: { day: 1, hour: 17.35, scale: 0.18, phase: "sunset" },
    weather: {
      type: "cloudy",
      target: "cloudy",
      intensity: 0.42,
      wetness: 0.38,
      windX: 0.42,
      windZ: -0.18,
      lightning: 0,
      visibility: 0.82,
    },
    progress: {
      elderMet: false,
      beaconInspected: false,
      resinFound: false,
      ironFittingsFound: false,
      villageDefenseComplete: false,
      beaconLit: false,
      fortressUnlocked: false,
      wolfDenCleared: false,
      merchantRouteOpen: false,
      wardenDefeated: false,
      returnedToVillage: false,
    },
    village: {
      guardMorale: 0.42,
      safety: 0.28,
      reputation: 0,
      corruption: 0.82,
      civiliansOutside: 1,
      nearTownSpawnMultiplier: 1,
    },
    ui: {
      prompt: "",
      toast: "",
      toastUntil: 0,
      dialogue: null,
      panel: null,
      objective: "Find the village elder",
    },
    diagnostics: {
      ready: false,
      fps: 0,
      drawCalls: 0,
      triangles: 0,
      rtxPath: "WEBGPU FALLBACK",
      lastError: "",
    },
  };
}

export function applyProgressCoupling(state) {
  const progress = state.progress;
  if (progress.wolfDenCleared) {
    progress.merchantRouteOpen = true;
    state.village.safety = Math.max(state.village.safety, 0.54);
  }
  if (progress.beaconLit) {
    progress.fortressUnlocked = true;
    state.village.guardMorale = Math.max(state.village.guardMorale, 0.82);
    state.village.safety = Math.max(state.village.safety, 0.68);
    state.village.nearTownSpawnMultiplier = 0.32;
    state.village.corruption = Math.min(state.village.corruption, 0.48);
  }
  if (progress.wardenDefeated) {
    state.village.guardMorale = 1;
    state.village.safety = 0.96;
    state.village.corruption = 0.08;
    state.village.nearTownSpawnMultiplier = 0.08;
  }
  return state;
}

export function snapshotState(state, additions = {}) {
  return structuredClone({
    elapsed: state.elapsed,
    simulationTick: state.simulationTick,
    time: state.time,
    weather: state.weather,
    progress: state.progress,
    village: state.village,
    diagnostics: state.diagnostics,
    ...additions,
  });
}
