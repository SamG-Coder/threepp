import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  color,
  exp,
  float,
  length,
  log,
  max,
  mix,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec4,
} from "three/tsl";

const CRITICAL_IMPACT_M = 3 * Math.sqrt(3);
const STRONG_DEFLECTION_CONSTANT = Math.log(216 * (7 - 4 * Math.sqrt(3))) - Math.PI;

export function createSchwarzschildLensingNode(inputTexture) {
  const center = uniform(new THREE.Vector2(0.5, 0.5));
  const aspect = uniform(16 / 9);
  const massAngularRadius = uniform(0.01);
  const angularToUv = uniform(1 / (2 * Math.tan(THREE.MathUtils.degToRad(46) * 0.5)));
  const strength = uniform(1);
  const ringExposure = uniform(1);

  const delta = screenUV.sub(center);
  const metric = vec2(delta.x.mul(aspect), delta.y);
  const radius = max(length(metric), 0.000001);
  const impactM = radius.div(max(massAngularRadius, 0.000001));

  // Schwarzschild bending: second-order weak field outside 10M, logarithmic
  // strong-deflection limit beside the critical 3sqrt(3)M impact parameter.
  const weak = float(4).div(impactM)
    .add(float(15 * Math.PI / 4).div(impactM.mul(impactM)));
  const criticalOffset = max(impactM.div(CRITICAL_IMPACT_M).sub(1), 0.00008);
  const strong = log(criticalOffset).negate().add(STRONG_DEFLECTION_CONSTANT);
  const bendRadians = mix(strong, weak, smoothstep(6, 10, impactM));
  const lensWindow = float(1).sub(smoothstep(20, 38, impactM));
  const bendUv = clamp(bendRadians.mul(angularToUv), -0.19, 0.19)
    .mul(strength)
    .mul(lensWindow);
  const sourceRadius = radius.sub(bendUv);
  const direction = metric.div(radius);
  const sourceMetric = direction.mul(sourceRadius);
  const sourceUv = center.add(vec2(sourceMetric.x.div(aspect), sourceMetric.y));
  const safeUv = clamp(sourceUv, vec2(0.001), vec2(0.999));

  const original = inputTexture.sample(screenUV);
  const lensed = inputTexture.sample(safeUv);
  const outside = smoothstep(CRITICAL_IMPACT_M - 0.035, CRITICAL_IMPACT_M + 0.035, impactM);
  const influence = lensWindow.mul(strength);
  const warped = mix(original, lensed, influence).mul(outside);

  // The geometric ring is infinitesimal. This narrow emissive profile is a
  // camera/readability treatment centered on the exact critical impact.
  const ring = exp(abs(impactM.sub(CRITICAL_IMPACT_M)).mul(-11.5))
    .mul(ringExposure)
    .mul(strength)
    .mul(2.45);
  const innerEcho = exp(abs(impactM.sub(CRITICAL_IMPACT_M * 1.035)).mul(-34))
    .mul(ringExposure)
    .mul(strength)
    .mul(0.7);
  const ringColor = color(0xffd8a0).mul(ring).add(color(0xb8ddff).mul(innerEcho));
  const output = vec4(warped.rgb.add(ringColor), original.a);

  return {
    output,
    uniforms: { center, aspect, massAngularRadius, angularToUv, strength, ringExposure },
  };
}
