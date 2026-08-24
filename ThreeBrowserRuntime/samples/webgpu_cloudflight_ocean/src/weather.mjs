import * as THREE from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  cameraPosition,
  color,
  cos,
  dot,
  exp,
  float,
  getViewPosition,
  length,
  mix,
  modelPosition,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  texture,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const CLOUD_BASE_METERS = 760;
export const CLOUD_TOP_METERS = 2860;
export const CLOUD_MAX_DISTANCE_METERS = 32_000;

const CLOUD_VIEW_STEPS = 64;
const CLOUD_LIGHT_STEPS = 4;
const CLOUD_REFLECTION_STEPS = Object.freeze([0.125, 0.375, 0.625, 0.875]);
const SUN_DISC_OUTER_DOT = Math.cos(0.00525);
const SUN_DISC_INNER_DOT = Math.cos(0.00435);
const INV_FOUR_PI = 1 / (4 * Math.PI);

export const weatherTime = uniform(0);
export const weatherDelta = uniform(0);
export const weatherWind = uniform(new THREE.Vector2(17.5, 6.0));
export const weatherSunDirection = uniform(
  new THREE.Vector3(-0.36, 0.48, -0.80).normalize(),
);
export const weatherSunRadiance = uniform(new THREE.Vector3(9.8, 9.1, 8.0));
export const weatherCloudBase = uniform(CLOUD_BASE_METERS);
export const weatherCloudTop = uniform(CLOUD_TOP_METERS);
export const weatherCloudCoverage = uniform(0.68);
export const weatherCloudDensity = uniform(1.0);
export const weatherCloudExtinction = uniform(0.00145);
export const weatherStorminess = uniform(0.72);
export const weatherLightningFlash = uniform(0);
export const weatherLightningPosition = uniform(
  new THREE.Vector3(-2200, 1650, -4800),
);

// A fullscreen pass is normally rendered with an orthographic quad camera.
// Keep the flight camera matrices explicit so depth reconstruction never
// accidentally uses that presentation camera.
export const weatherCameraPosition = uniform(new THREE.Vector3());
export const weatherInverseProjection = uniform(new THREE.Matrix4());
export const weatherCameraWorld = uniform(new THREE.Matrix4());

export const weatherUniforms = Object.freeze({
  time: weatherTime,
  delta: weatherDelta,
  wind: weatherWind,
  sunDirection: weatherSunDirection,
  sunRadiance: weatherSunRadiance,
  cloudBase: weatherCloudBase,
  cloudTop: weatherCloudTop,
  cloudCoverage: weatherCloudCoverage,
  cloudDensity: weatherCloudDensity,
  cloudExtinction: weatherCloudExtinction,
  storminess: weatherStorminess,
  lightningFlash: weatherLightningFlash,
  lightningPosition: weatherLightningPosition,
  cameraPosition: weatherCameraPosition,
  inverseProjection: weatherInverseProjection,
  cameraWorld: weatherCameraWorld,
});

const scratchCameraPosition = new THREE.Vector3();

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function copyVector2(target, value) {
  if (!value) return;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    target.set(finiteNumber(value[0], target.x), finiteNumber(value[1], target.y));
  } else {
    target.set(
      finiteNumber(value.x, target.x),
      finiteNumber(value.z ?? value.y, target.y),
    );
  }
}

function copyVector3(target, value, normalizeResult = false) {
  if (!value) return;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    target.set(
      finiteNumber(value[0], target.x),
      finiteNumber(value[1], target.y),
      finiteNumber(value[2], target.z),
    );
  } else {
    target.set(
      finiteNumber(value.x, target.x),
      finiteNumber(value.y, target.y),
      finiteNumber(value.z, target.z),
    );
  }
  if (normalizeResult && target.lengthSq() > 1e-12) target.normalize();
}

function automaticLightningPulse(timeSeconds) {
  const cycle = 17.3;
  const phase = ((timeSeconds + 2.7) % cycle + cycle) % cycle;
  const pulse = (centre, width, strength) => {
    const x = (phase - centre) / width;
    return Math.exp(-x * x) * strength;
  };
  return Math.min(1, Math.max(
    pulse(0.16, 0.032, 0.72),
    pulse(0.29, 0.046, 1.0),
    pulse(0.52, 0.075, 0.48),
  ));
}

/** Update every frame before rendering either the scene or weather pass. */
export function updateWeather(
  timeSeconds,
  deltaSeconds = 0,
  camera = null,
  options = {},
) {
  const time = finiteNumber(timeSeconds, weatherTime.value);
  weatherTime.value = time;
  weatherDelta.value = Math.max(0, finiteNumber(deltaSeconds, 0));

  if (camera) {
    camera.updateMatrixWorld();
    camera.getWorldPosition(scratchCameraPosition);
    weatherCameraPosition.value.copy(scratchCameraPosition);
    weatherCameraWorld.value.copy(camera.matrixWorld);
    // Copy and invert here rather than trusting a stale projectionMatrixInverse
    // after a resize or cockpit field-of-view change.
    weatherInverseProjection.value.copy(camera.projectionMatrix).invert();
  }

  copyVector2(weatherWind.value, options.wind);
  copyVector3(weatherSunDirection.value, options.sunDirection, true);
  copyVector3(weatherSunRadiance.value, options.sunRadiance);
  copyVector3(weatherLightningPosition.value, options.lightningPosition);

  if (options.cloudBase !== undefined) {
    weatherCloudBase.value = finiteNumber(options.cloudBase, weatherCloudBase.value);
  }
  weatherCloudTop.value = Math.max(
    weatherCloudBase.value + 10,
    weatherCloudTop.value,
  );
  if (options.cloudTop !== undefined) {
    weatherCloudTop.value = Math.max(
      weatherCloudBase.value + 10,
      finiteNumber(options.cloudTop, weatherCloudTop.value),
    );
  }
  const coverage = options.cloudCoverage ?? options.coverage;
  if (coverage !== undefined) {
    weatherCloudCoverage.value = THREE.MathUtils.clamp(
      finiteNumber(coverage, weatherCloudCoverage.value),
      0,
      1,
    );
  }
  const density = options.cloudDensity ?? options.density;
  if (density !== undefined) {
    weatherCloudDensity.value = Math.max(
      0,
      finiteNumber(density, weatherCloudDensity.value),
    );
  }
  if (options.cloudExtinction !== undefined) {
    weatherCloudExtinction.value = Math.max(
      0,
      finiteNumber(options.cloudExtinction, weatherCloudExtinction.value),
    );
  }
  const storminess = options.storminess ?? options.storm;
  if (storminess !== undefined) {
    weatherStorminess.value = THREE.MathUtils.clamp(
      finiteNumber(storminess, weatherStorminess.value),
      0,
      1,
    );
  }

  const flash = options.lightningFlash !== undefined
    ? finiteNumber(options.lightningFlash, 0)
    : (options.autoLightning === false ? 0 : automaticLightningPulse(time));
  weatherLightningFlash.value = THREE.MathUtils.clamp(flash, 0, 1);

  return weatherUniforms;
}

function safeSignedVerticalNode(vertical) {
  const magnitude = abs(vertical).max(0.0001);
  return mix(magnitude.negate(), magnitude, step(0, vertical));
}

function cloudLayerSegmentNode(origin, direction, stopDistance) {
  const maximumDistance = float(stopDistance).max(0);
  const safeY = safeSignedVerticalNode(direction.y);
  const baseDistance = weatherCloudBase.sub(origin.y).div(safeY);
  const topDistance = weatherCloudTop.sub(origin.y).div(safeY);
  const entry = baseDistance.min(topDistance).max(0);
  const exit = baseDistance.max(topDistance)
    .min(maximumDistance)
    .min(CLOUD_MAX_DISTANCE_METERS);
  return {
    start: entry,
    end: exit,
    length: exit.sub(entry).max(0),
  };
}

/** Shared animated density field in metres. */
export function cloudDensityNode(point) {
  const layerThickness = weatherCloudTop.sub(weatherCloudBase).max(10);
  const height = point.y.sub(weatherCloudBase).div(layerThickness);
  const advected = vec2(point.x, point.z).sub(weatherWind.mul(weatherTime));

  // Two broad incommensurate cells are the weather map. They make banks and
  // rain gaps coherent over kilometres without another expensive noise octave.
  const weatherA = sin(
    advected.x.mul(0.000105).add(advected.y.mul(0.000052)).add(1.7),
  );
  const weatherB = cos(
    advected.x.mul(-0.000041).add(advected.y.mul(0.000121)).sub(0.8),
  );
  const weatherCell = weatherA.mul(0.62).add(weatherB.mul(0.38))
    .mul(0.5).add(0.5).saturate();
  const localCoverage = weatherCloudCoverage
    .add(weatherCell.sub(0.5).mul(0.56))
    .saturate();

  const coarseCoord = vec3(
    advected.x.mul(0.000235).add(height.mul(0.16)),
    point.y.mul(0.00039),
    advected.y.mul(0.000235).sub(height.mul(0.11)),
  ).add(vec3(7.1, -2.4, 11.6));
  const coarse = mx_noise_float(coarseCoord).mul(0.5).add(0.5);
  const detail = mx_noise_float(
    coarseCoord.mul(3.07).add(vec3(17.1, -8.3, 5.7)),
  ).mul(0.5).add(0.5);
  const structure = coarse.sub(detail.mul(0.22)).add(weatherCell.mul(0.12));
  const onset = mix(float(0.80), float(0.47), localCoverage);
  const body = smoothstep(onset, onset.add(0.115), structure);

  // Convective storm cells hang lower and build a softer anvil near the top.
  const baseLift = float(0.08).mul(float(1).sub(weatherCell));
  const lowerProfile = smoothstep(baseLift, baseLift.add(0.13), height);
  const topStart = mix(float(0.66), float(0.79), weatherCell);
  const upperProfile = float(1).sub(smoothstep(topStart, 1, height));
  const profile = lowerProfile.mul(upperProfile);

  return body.mul(profile).mul(weatherCloudDensity).saturate();
}

function henyeyGreensteinNode(cosTheta, asymmetry) {
  const denominator = float(1 + asymmetry * asymmetry)
    .sub(cosTheta.mul(2 * asymmetry))
    .max(0.0001);
  return float((1 - asymmetry * asymmetry) * INV_FOUR_PI)
    .div(pow(denominator, 1.5));
}

function cloudPhaseNode(ray) {
  const alignment = dot(ray, weatherSunDirection).clamp(-1, 1);
  return henyeyGreensteinNode(alignment, 0.72).mul(0.90)
    .add(henyeyGreensteinNode(alignment, -0.20).mul(0.10));
}

/** Analytic clear daylight used by both the visible dome and water. */
export function clearSkyRadianceNode(inputRay) {
  const ray = normalize(inputRay);
  const elevation = ray.y.max(0).saturate();
  const zenithMix = pow(elevation, 0.38);
  const clearSky = mix(color(0xa5bbc4), color(0x285a91), zenithMix);
  const horizonHaze = color(0xd8d0bc).mul(
    pow(float(1).sub(elevation), 7).mul(0.34),
  );
  const stormDesaturation = mix(
    vec3(1),
    color(0x83939a),
    weatherStorminess.mul(0.22),
  );

  const sunAlignment = dot(ray, weatherSunDirection).clamp(-1, 1);
  const daylight = smoothstep(-0.06, 0.04, weatherSunDirection.y);
  const outerAureole = pow(sunAlignment.max(0), 64).mul(0.050);
  const innerAureole = pow(sunAlignment.max(0), 520).mul(0.18);
  const sunDisc = smoothstep(
    SUN_DISC_OUTER_DOT,
    SUN_DISC_INNER_DOT,
    sunAlignment,
  );
  const sun = weatherSunRadiance.mul(
    sunDisc.mul(1.7).add(innerAureole).add(outerAureole).mul(daylight),
  );

  return clearSky.mul(stormDesaturation)
    .add(horizonHaze)
    .add(sun);
}

export function reflectedWeatherSkyNode(origin, inputRay) {
  const ray = normalize(inputRay);
  const clearSky = clearSkyRadianceNode(ray);
  const segment = cloudLayerSegmentNode(origin, ray, CLOUD_MAX_DISTANCE_METERS);
  let densityIntegral = float(0);

  for (const position of CLOUD_REFLECTION_STEPS) {
    const distance = segment.start.add(segment.length.mul(position));
    densityIntegral = densityIntegral.add(
      cloudDensityNode(origin.add(ray.mul(distance))),
    );
  }

  const meanDensity = densityIntegral.div(CLOUD_REFLECTION_STEPS.length);
  const opticalDepth = meanDensity
    .mul(segment.length)
    .mul(weatherCloudExtinction);
  const transmission = exp(opticalDepth.negate());
  const opacity = float(1).sub(transmission);
  const lightTransmission = exp(meanDensity.mul(-1.35));
  const phase = cloudPhaseNode(ray);
  const ambient = mix(color(0x566874), color(0xb9c8ce),
    float(1).sub(weatherStorminess).mul(0.55));
  const cloudLight = ambient.mul(0.34)
    .add(weatherSunRadiance.mul(phase).mul(lightTransmission).mul(0.72));

  return clearSky.mul(transmission).add(cloudLight.mul(opacity));
}

export function createClearSkyMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Cloudflight clear atmospheric sky",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const ray = normalize(positionWorld.sub(cameraPosition));
  material.colorNode = clearSkyRadianceNode(ray);
  material.toneMapped = true;
  material.rtxReflectionMask = 0;
  return material;
}

const OCEAN_WAVES = Object.freeze([
  { x: 0.342, z: 0.940, k: 0.010, amplitude: 1.55, phase: 0.2 },
  { x: 0.515, z: 0.857, k: 0.018, amplitude: 0.92, phase: 1.7 },
  { x: 0.080, z: 0.997, k: 0.031, amplitude: 0.48, phase: -0.8 },
  { x: -0.405, z: 0.914, k: 0.052, amplitude: 0.24, phase: 2.4 },
  { x: 0.811, z: 0.585, k: 0.083, amplitude: 0.115, phase: -2.0 },
  { x: -0.622, z: 0.783, k: 0.135, amplitude: 0.052, phase: 0.9 },
  { x: 0.226, z: 0.974, k: 0.220, amplitude: 0.022, phase: 2.9 },
]);

function oceanWaveStateNode(point, waveCount = OCEAN_WAVES.length, viewDistance = null) {
  const energy = weatherStorminess.mul(0.72).add(0.54);
  let height = float(0);
  let slopeX = float(0);
  let slopeZ = float(0);
  let offsetX = float(0);
  let offsetZ = float(0);

  for (let waveIndex = 0; waveIndex < waveCount; ++waveIndex) {
    const wave = OCEAN_WAVES[waveIndex];
    let detailFade = float(1);
    if (viewDistance && waveIndex >= 3) {
      const detail = (waveIndex - 3) / Math.max(1, OCEAN_WAVES.length - 4);
      const fadeStart = THREE.MathUtils.lerp(820, 140, detail);
      const fadeEnd = THREE.MathUtils.lerp(2_300, 620, detail);
      detailFade = float(1).sub(smoothstep(fadeStart, fadeEnd, viewDistance));
    }
    const angularFrequency = Math.sqrt(9.81 * wave.k);
    const angle = point.x.mul(wave.x).add(point.z.mul(wave.z))
      .mul(wave.k)
      .add(weatherTime.mul(angularFrequency))
      .add(wave.phase);
    const waveSin = sin(angle);
    const waveCos = cos(angle);
    const amplitude = float(wave.amplitude).mul(detailFade);
    height = height.add(waveSin.mul(amplitude));
    slopeX = slopeX.add(waveCos.mul(amplitude).mul(wave.k * wave.x));
    slopeZ = slopeZ.add(waveCos.mul(amplitude).mul(wave.k * wave.z));
    const chop = waveCos.mul(amplitude).mul(0.18);
    offsetX = offsetX.add(chop.mul(wave.x));
    offsetZ = offsetZ.add(chop.mul(wave.z));
  }

  return {
    displacement: vec3(offsetX, height, offsetZ).mul(energy),
    slopeX: slopeX.mul(energy),
    slopeZ: slopeZ.mul(energy),
    height: height.mul(energy),
  };
}

export function createProceduralOceanMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Cloudflight live procedural ocean",
    side: THREE.DoubleSide,
    color: 0x073a4b,
    metalness: 0,
    roughness: 0.12,
    ior: 1.333,
    clearcoat: 0,
    envMapIntensity: 0,
    fog: true,
  });

  // The mesh is periodically snapped under the aircraft. Include its world XZ
  // translation in the phase coordinate so snapping does not reset the sea.
  const absoluteLocalPoint = positionLocal.add(vec3(
    modelPosition.x,
    0,
    modelPosition.z,
  ));
  // The finite flight-ocean mesh has roughly 135 m vertex spacing. Only the
  // long swells belong in vertex displacement; shorter waves in geometry
  // alias into the horizon as bright grid lines.
  const vertexWaves = oceanWaveStateNode(absoluteLocalPoint, 2);
  material.positionNode = positionLocal.add(vertexWaves.displacement);

  const viewDistance = length(cameraPosition.sub(vec3(
    absoluteLocalPoint.x,
    0,
    absoluteLocalPoint.z,
  )));
  const fragmentWaves = oceanWaveStateNode(
    absoluteLocalPoint,
    OCEAN_WAVES.length - 2,
    viewDistance,
  );
  // A low-amplitude, non-directional perturbation breaks the repetitive
  // parallel bands of the analytic swells without turning distant water into
  // a sub-pixel comb.
  const micro = mx_noise_float(vec3(
    absoluteLocalPoint.x.mul(0.012),
    weatherTime.mul(0.025),
    absoluteLocalPoint.z.mul(0.012),
  )).mul(float(1).sub(smoothstep(900, 3_800, viewDistance))).mul(0.018);
  const normal = normalize(vec3(
    fragmentWaves.slopeX.negate().add(micro),
    1,
    fragmentWaves.slopeZ.negate().sub(micro),
  ));
  const view = normalize(cameraPosition.sub(positionWorld));
  const normalDotView = abs(dot(normal, view)).saturate();
  const fresnel = float(0.02037).add(
    float(0.97963).mul(pow(float(1).sub(normalDotView), 5)),
  );
  const reflectedRay = normalize(reflect(view.negate(), normal));
  const reflectedSky = reflectedWeatherSkyNode(
    positionWorld.add(normal.mul(2)),
    reflectedRay,
  );

  const waterNoise = mx_noise_float(vec3(
    positionWorld.x.mul(0.0018).add(weatherTime.mul(0.014)),
    float(0.17),
    positionWorld.z.mul(0.0018).sub(weatherTime.mul(0.009)),
  )).mul(0.5).add(0.5);
  const deepWater = mix(color(0x031925), color(0x0b5263), waterNoise);
  const slopeMagnitude = abs(fragmentWaves.slopeX)
    .add(abs(fragmentWaves.slopeZ));
  const foam = smoothstep(0.20, 0.42, slopeMagnitude)
    .mul(smoothstep(0.15, 1.20, fragmentWaves.height))
    .mul(weatherStorminess)
    .saturate();
  const foamReflectance = color(0xa7c3c3);
  const clearReflectance = deepWater.mul(float(1).sub(fresnel));
  material.colorNode = mix(clearReflectance, foamReflectance, foam);
  material.emissiveNode = reflectedSky
    .mul(fresnel)
    .mul(float(1).sub(foam));
  material.normalNode = transformNormalToView(normal);
  material.roughnessNode = mix(float(0.15), float(0.48), foam);

  // The animated ocean and its live environment are not static TLAS content.
  material.rtxReflectionMask = 0;
  return material;
}

export const createOceanMaterial = createProceduralOceanMaterial;

function requireTexture(value, label) {
  if (!value?.isTexture) {
    throw new TypeError(`${label} must be a Three.js Texture.`);
  }
}

/**
 * Fullscreen linear-HDR cloud composite. The supplied depth must come from the
 * flight camera used in updateWeather(), not from the fullscreen quad camera.
 */
export function createVolumetricCloudCompositorMaterial(
  sceneColorTexture,
  sceneDepthTexture,
  hudTexture,
  windscreenRainTexture,
) {
  requireTexture(sceneColorTexture, "Cloud compositor sceneColorTexture");
  requireTexture(sceneDepthTexture, "Cloud compositor sceneDepthTexture");
  requireTexture(hudTexture, "Cloud compositor hudTexture");
  requireTexture(windscreenRainTexture, "Cloud compositor windscreenRainTexture");

  // Screen-space corners are supplied by the real camera-mounted trapezoid in
  // cockpit.mjs. Keeping these as uniforms makes the wet surface follow cabin
  // vibration and resize without hard-coding a screen rectangle.
  const windscreenBottomLeft = uniform(new THREE.Vector2(0.18, 0.25));
  const windscreenBottomRight = uniform(new THREE.Vector2(0.82, 0.25));
  const windscreenTopRight = uniform(new THREE.Vector2(0.66, 0.80));
  const windscreenTopLeft = uniform(new THREE.Vector2(0.34, 0.80));
  const windscreenWetness = uniform(0);

  const material = new THREE.NodeMaterial();
  material.name = "Cloudflight depth-aware volumetric cloud compositor";
  material.depthTest = false;
  material.depthWrite = false;
  material.transparent = false;
  material.blending = THREE.NoBlending;
  material.toneMapped = true;

  material.fragmentNode = Fn(() => {
    const passUv = uv();
    // Native WebGPU render targets are stored with their origin opposite to
    // the fullscreen presentation UVs. Color, depth and view reconstruction
    // must all address the same source pixel or the atmospheric horizon will
    // slide against the camera as it pitches and rolls.
    const targetUv = vec2(passUv.x, float(1).sub(passUv.y));
    const base = texture(sceneColorTexture, targetUv);
    const sceneDepth = texture(sceneDepthTexture, targetUv).r;
    const viewEnd = getViewPosition(
      targetUv,
      sceneDepth,
      weatherInverseProjection,
    );
    const worldEnd4 = weatherCameraWorld.mul(vec4(viewEnd, 1));
    const worldEnd = worldEnd4.xyz.div(worldEnd4.w.max(0.0001));
    const rayVector = worldEnd.sub(weatherCameraPosition);
    const sceneDistance = length(rayVector);
    const ray = normalize(rayVector);
    const segment = cloudLayerSegmentNode(
      weatherCameraPosition,
      ray,
      sceneDistance,
    );

    const radiance = vec3(0).toVar();
    const transmittance = float(1).toVar();
    const stepLength = segment.length.div(CLOUD_VIEW_STEPS);
    // A screen-space interleaved offset is only appropriate when a temporal
    // resolve accumulates it. This runtime presents each frame directly, so
    // the pattern became visible as diagonal screen-door lines in cloud. A
    // centred sample with a denser march is stable under camera motion.
    const jitter = float(0.5);
    const phase = cloudPhaseNode(ray);
    const daylight = smoothstep(-0.04, 0.07, weatherSunDirection.y);
    const ambient = mix(
      color(0x35434b),
      color(0x9bafb8),
      float(1).sub(weatherStorminess).mul(0.62),
    );

    If(segment.length.greaterThan(0.05), () => {
      Loop(CLOUD_VIEW_STEPS, ({ i }) => {
        const distance = segment.start.add(
          float(i).add(jitter).mul(stepLength),
        );
        const samplePoint = weatherCameraPosition.add(ray.mul(distance));
        const density = cloudDensityNode(samplePoint);

        If(density.greaterThan(0.004), () => {
          const lightTransmission = float(0).toVar();

          If(daylight.greaterThan(0.001), () => {
            const distanceToTop = weatherCloudTop.sub(samplePoint.y)
              .div(weatherSunDirection.y.max(0.045))
              .max(0)
              .min(9000);
            const lightStep = distanceToTop.div(CLOUD_LIGHT_STEPS);
            const lightTau = float(0).toVar();

            Loop(CLOUD_LIGHT_STEPS, ({ i: lightIndex }) => {
              const lightDistance = float(lightIndex).add(0.5).mul(lightStep);
              const lightPoint = samplePoint.add(
                weatherSunDirection.mul(lightDistance),
              );
              lightTau.addAssign(
                cloudDensityNode(lightPoint)
                  .mul(weatherCloudExtinction)
                  .mul(lightStep),
              );
            });
            lightTransmission.assign(exp(lightTau.negate()));
          });

          const sampleOpticalDepth = density
            .mul(weatherCloudExtinction)
            .mul(stepLength);
          const sampleTransmission = exp(sampleOpticalDepth.negate());
          const scatterWeight = float(1).sub(sampleTransmission);
          const powder = float(1).sub(exp(sampleOpticalDepth.mul(-2.2)));
          const sunSource = weatherSunRadiance
            .mul(phase)
            .mul(lightTransmission)
            .mul(daylight);

          const lightningVector = weatherLightningPosition.sub(samplePoint);
          const lightningDistanceSquared = dot(
            lightningVector,
            lightningVector,
          ).max(2500);
          const lightningSource = vec3(0.52, 0.68, 1.0).mul(
            weatherLightningFlash.mul(115000).div(lightningDistanceSquared),
          );
          const source = ambient.mul(powder.mul(0.48).add(0.34))
            .add(sunSource)
            .add(lightningSource);

          radiance.addAssign(
            transmittance.mul(scatterWeight).mul(source),
          );
          transmittance.mulAssign(sampleTransmission);
        });

        If(transmittance.lessThan(0.012), () => {
          Break();
        });
      });
    });

    const lightningVeil = vec3(0.20, 0.28, 0.46)
      .mul(weatherLightningFlash.mul(0.018));
    // The visible sky deliberately does not write depth. Re-evaluate that
    // exact clear-sky function at the far-depth sentinel so the composite does
    // not depend on render-target background or sky-dome draw ordering.
    const background = mix(
      base.rgb,
      clearSkyRadianceNode(ray),
      step(0.999999, sceneDepth),
    );
    const composite = background.mul(transmittance)
      .add(radiance)
      .add(lightningVeil);

    // Signed distance to each projected pane edge. The corners are CCW in
    // bottom-left screen UV space, so their minimum is positive only inside
    // the real windscreen. This is evaluated after clouds: the pane and its
    // water cannot be visually overwritten by the atmospheric march.
    const edgeDistance = (start, end, point) => {
      const edge = end.sub(start);
      const relative = point.sub(start);
      return edge.x.mul(relative.y)
        .sub(edge.y.mul(relative.x))
        .div(length(edge).max(0.00001));
    };
    const paneDistance = edgeDistance(windscreenBottomLeft, windscreenBottomRight, passUv)
      .min(edgeDistance(windscreenBottomRight, windscreenTopRight, passUv))
      .min(edgeDistance(windscreenTopRight, windscreenTopLeft, passUv))
      .min(edgeDistance(windscreenTopLeft, windscreenBottomLeft, passUv));
    const paneMask = smoothstep(-0.0015, 0.0025, paneDistance);
    const bottomY = windscreenBottomLeft.y.add(windscreenBottomRight.y).mul(0.5);
    const topY = windscreenTopLeft.y.add(windscreenTopRight.y).mul(0.5);
    const paneV = passUv.y.sub(bottomY)
      .div(topY.sub(bottomY).max(0.00001))
      .saturate();
    const leftEdge = mix(windscreenBottomLeft, windscreenTopLeft, paneV);
    const rightEdge = mix(windscreenBottomRight, windscreenTopRight, paneV);
    const paneU = passUv.x.sub(leftEdge.x)
      .div(rightEdge.x.sub(leftEdge.x).max(0.00001))
      .saturate();
    const wetSurface = texture(
      windscreenRainTexture,
      vec2(paneU, float(1).sub(paneV)),
    );

    // Even dry laminated glass carries a cool absorption tint and stronger
    // grazing reflection near its seal. Water beads then add dark rims and a
    // pale specular core. The HUD remains last and therefore stays readable.
    const paneEdgeSheen = float(1).sub(
      smoothstep(0.004, 0.065, paneDistance.max(0)),
    ).mul(paneMask);
    const glassAmount = paneMask.mul(0.052).add(paneEdgeSheen.mul(0.060));
    const glassTone = composite.mul(vec3(0.958, 0.988, 1.022))
      .add(vec3(0.006, 0.014, 0.020));
    const glassComposite = mix(composite, glassTone, glassAmount);
    const beadCoverage = wetSurface.a
      .mul(paneMask)
      .mul(windscreenWetness.mul(0.55).add(0.45))
      .saturate();
    const wetComposite = glassComposite
      .mul(float(1).sub(beadCoverage.mul(0.15)))
      .add(wetSurface.rgb.mul(beadCoverage.mul(0.56)));
    // The HUD is sampled in this same fullscreen shader, so only this one
    // render reaches the swapchain. RenderTarget textures use the opposite Y
    // convention from the fullscreen presentation UVs in the native backend.
    const hud = texture(hudTexture, vec2(passUv.x, float(1).sub(passUv.y)));
    const presented = mix(wetComposite, hud.rgb, hud.a);
    return vec4(presented, 1);
  })();

  material.userData.windscreenRain = Object.freeze({
    bottomLeft: windscreenBottomLeft,
    bottomRight: windscreenBottomRight,
    topRight: windscreenTopRight,
    topLeft: windscreenTopLeft,
    wetness: windscreenWetness,
  });
  return material;
}

export const createCloudCompositorMaterial =
  createVolumetricCloudCompositorMaterial;
