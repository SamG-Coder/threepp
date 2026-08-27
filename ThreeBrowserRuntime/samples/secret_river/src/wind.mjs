import {
  float,
  max,
  positionLocal,
  positionWorld,
  saturate,
  sin,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import { FOLIAGE_GAIN } from "./wind-weights.mjs";

export { FOLIAGE_GAIN, foliageDisplacementWeight, tipSwayWeight } from "./wind-weights.mjs";

export const windTime = uniform(0);

export function setWindTime(elapsed) {
  windTime.value = elapsed;
}

function gust() {
  return sin(windTime.mul(1.45).add(positionWorld.x.mul(0.38)))
    .add(sin(windTime.mul(2.25).add(positionWorld.z.mul(0.21))).mul(0.55));
}

/** Whole-plant sway for reeds and grass: more at the tips, rooted at the base. */
export function applyCardWind(material, amount) {
  const sway = gust().mul(uv().y).mul(uv().y).mul(amount);
  material.positionNode = positionLocal.add(vec3(sway, float(0), sway.mul(0.18)));
}

/**
 * Tree cards are one photo. Subdivide the plane and only push vertices
 * whose texel is foliage (green over red/blue). Bark stays put.
 * extra-green * FOLIAGE_GAIN matches foliageDisplacementWeight().
 */
export function applyFoliageWind(material, map, amount) {
  const sample = texture(map, uv());
  const leaf = saturate(sample.g.sub(max(sample.r, sample.b)).mul(FOLIAGE_GAIN));
  const sway = gust().mul(leaf).mul(uv().y).mul(amount);
  material.positionNode = positionLocal.add(vec3(sway, float(0), sway.mul(0.12)));
}
