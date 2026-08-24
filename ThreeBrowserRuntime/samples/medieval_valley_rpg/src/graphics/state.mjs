import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";

// A single uniform block drives every animated material. The world updater only
// touches these small values; wind, wetness, fire and corruption stay on-GPU.
export const graphicsTime = uniform(0);
export const graphicsDelta = uniform(0);
export const worldWetness = uniform(0.18);
export const worldWind = uniform(new THREE.Vector2(0.7, 0.22));
export const worldRain = uniform(0);
export const worldStorm = uniform(0);
export const worldNight = uniform(0);
export const worldCorruption = uniform(0.76);
export const beaconStrength = uniform(0);

export const graphicsUniforms = Object.freeze({
  time: graphicsTime,
  delta: graphicsDelta,
  wetness: worldWetness,
  wind: worldWind,
  rain: worldRain,
  storm: worldStorm,
  night: worldNight,
  corruption: worldCorruption,
  beacon: beaconStrength,
});

export function updateGraphicsUniforms(timeSeconds, deltaSeconds, state = {}) {
  if (Number.isFinite(timeSeconds)) graphicsTime.value = timeSeconds;
  if (Number.isFinite(deltaSeconds)) graphicsDelta.value = Math.max(0, deltaSeconds);
  if (Number.isFinite(state.wetness)) worldWetness.value = THREE.MathUtils.clamp(state.wetness, 0, 1);
  if (Number.isFinite(state.rain)) worldRain.value = THREE.MathUtils.clamp(state.rain, 0, 1);
  if (Number.isFinite(state.storm)) worldStorm.value = THREE.MathUtils.clamp(state.storm, 0, 1);
  if (Number.isFinite(state.night)) worldNight.value = THREE.MathUtils.clamp(state.night, 0, 1);
  if (Number.isFinite(state.corruption)) worldCorruption.value = THREE.MathUtils.clamp(state.corruption, 0, 1);
  if (Number.isFinite(state.beacon)) beaconStrength.value = THREE.MathUtils.clamp(state.beacon, 0, 1);
  const wind = state.wind;
  if (wind) {
    const x = Number(Array.isArray(wind) ? wind[0] : wind.x);
    const z = Number(Array.isArray(wind) ? wind[1] : (wind.z ?? wind.y));
    if (Number.isFinite(x)) worldWind.value.x = x;
    if (Number.isFinite(z)) worldWind.value.y = z;
  }
  return graphicsUniforms;
}
