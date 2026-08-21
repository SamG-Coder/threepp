import {
  Scene, PerspectiveCamera, WebGPURenderer, Color, Vector2, Vector3, Mesh, MathUtils,
  NeutralToneMapping,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { params, applySky, SKIES } from './ocean/params.js';
import { Ocean } from './ocean/Ocean.js';
import { validateFFT } from './ocean/fft.js';
import { createOceanSurfaceMaterial } from './ocean/oceanSurfaceMaterial.js';
import { makeDetailTexture } from './ocean/detailTexture.js';
import { createSkyDome, setSkyTexture } from './ocean/sky.js';
import { createRadialGrid } from './ocean/oceanGrid.js';
import { createAerialPerspective } from './ocean/atmosphere.js';
import { createGUI } from './gui.js';
import { createHUD, createPaletteSwitch, createSkySwitch } from './util/hud.js';
import { createFlyCamera } from './util/flyCamera.js';
import { captureConfig, applyOverrides, aimCamera } from './util/capture.js';

const shot = captureConfig();
if (shot) {
  applyOverrides(params, shot.overrides);
  if (shot.overrides?.sky) {
    applySky(params); // the shot switched panoramas — merge that rig...
    applyOverrides(params, shot.overrides); // ...but explicit overrides still win
  }
  document.body.classList.add('shot'); // hides the HUD; #err stays visible
}
const hud = createHUD();

async function main() {
  if (WebGPU.isAvailable() === false) {
    hud.error('WebGPU is not available. Use Chrome/Edge 113+ or Safari 18+ — this build has no WebGL fallback.');
    return;
  }

  const c = params.colors;
  const scene = new Scene();

  // far plane clears the sky dome, which now has to sit outside a 20 km ocean
  const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 60000);
  camera.position.set(0, 16, 68);

  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(new Color(c.skyHorizon), 1);
  // Khronos PBR Neutral, not ACES, and this is a colour decision rather than a
  // taste one. The sky panorama is golden hour — its sun measures 0xffd395, a
  // ratio of 1.00 / 0.83 / 0.58 — and under ACES the sea's sunlit highlights came
  // back at 1.00 / 0.99 / 0.98. White. The light was golden the whole way down
  // the shader; ACES was removing it at the very last step, because it
  // desaturates hard above its white point and a specular reflection of a
  // reconstructed sun sits eight to twelve times over it. Four separate
  // source-level corrections — the glitter's white mix, the reflection's warm
  // desaturation, the HDR reconstruction's hue, a pre-compensating power on that
  // hue — each moved the measured ratio by about one per cent, because none of
  // them was the thing in the way.
  //
  // Neutral is built for exactly this: it preserves hue and saturation into the
  // highlights instead of converging them on white. Same frame, same constants,
  // the road now measures 1.00 / 0.90 / 0.76 — golden, slightly desaturated the
  // way a real highlight is, with the core still clipping white. It is also not
  // a regression anywhere measurable: probe.mjs reports no blown pixels and no
  // clipped channels on any preset, and the horizon step got MORE negative in
  // every band, which is the direction that makes the sea terminate cleanly.
  //
  // One line to revert if the grade is ever wrong: ACESFilmicToneMapping. Note
  // that SAT_BOOST in oceanSurfaceMaterial.js exists to claw back ACES's
  // desaturation and is now doing less work than it was written for.
  // exposure is the frame's key — `?p={"exposure":1.2}` sweeps it from a shot.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = params.exposure ?? 1.2;
  document.body.appendChild(renderer.domElement);

  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) {
    hud.error('Renderer fell back to WebGL2 — this project targets WebGPU only.');
    return;
  }
  const device = renderer.backend.device;
  if (device && typeof device.addEventListener === 'function') {
    device.addEventListener('uncapturederror', (e) => hud.error('WebGPU validation: ' + (e.error?.message ?? String(e.error))));
  }

  // FFT isolation test (hard gate)
  const fftTest = await validateFFT(renderer, params.N);
  const fftStr = `FFT self-test: ${fftTest.pass ? 'PASS ✓' : 'FAIL ✗'} (impulse=${fftTest.err1.toExponential(1)}, freq=${fftTest.err2.toExponential(1)})`;
  if (!fftTest.pass) hud.error(fftStr + ' — IFFT not matching analytic result.');

  camera.lookAt(0, 2, -20);
  const fly = createFlyCamera(camera, renderer.domElement);
  if (shot) aimCamera(camera, shot.preset, params);

  // shared shading uniforms (sky dome + ocean reflection use the same values)
  const shading = {
    sunDir: uniform(new Vector3()),
    // radiance, not a swatch: hue from the sky panorama, magnitude from
    // sunIntensity, so every consumer multiplies by one value and is lit right
    sunColor: uniform(new Color(c.sun).multiplyScalar(params.sunIntensity)),
    horizon: uniform(new Color(c.skyHorizon)),
    zenith: uniform(new Color(c.skyZenith)),
    ambient: uniform(new Color(c.ambient)), // measured hemisphere irradiance
    deepColor: uniform(new Color(c.deep)),
    scatterColor: uniform(new Color(c.scatter)),
    // Which sea — 0 tropical green, 1 open-ocean blue. See SEA in
    // oceanSurfaceMaterial.js; it is a lerp, so a shot can ask for anything
    // between with `?p={"palette":0.5}`.
    palette: uniform(params.palette),
    sssStrength: uniform(params.sssStrength),
    foamColor: uniform(new Color(c.foam)),
    foamThreshold: uniform(params.foamThreshold),
    foamScale: uniform(params.foamScale),
    foamBright: uniform(params.foamBright), // top rung of the foam tonal ladder
    foamRelief: uniform(params.foamRelief), // foam micro-relief modulation
    foamMilk: uniform(params.foamMilk), // submerged bubble-plume opacity
    detail: uniform(params.detailStrength),
    time: uniform(0),
    originXZ: uniform(new Vector2()), // world-space centre of the ocean tile
    // per-sky atmosphere/glint — uniforms so the sky toggle switches them live
    hazeWater: uniform(1 / (SKIES[params.sky]?.hazeWater ?? 3200)),
    hazeAir: uniform(1 / (SKIES[params.sky]?.hazeAir ?? 2150)),
    specBoost: uniform(SKIES[params.sky]?.specBoost ?? 0),
  };
  function updateSun() {
    const az = MathUtils.degToRad(params.sunAzimuth);
    const el = MathUtils.degToRad(params.sunElevation);
    shading.sunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    shading.sunColor.value.set(params.colors.sun).multiplyScalar(params.sunIntensity);
  }
  updateSun();
  // The whole rig of a sky switch, live: preset merge, sun, ambient colours,
  // haze densities, glint boost, and the panorama swap itself.
  function applySkyLive(name) {
    params.sky = name;
    applySky(params);
    updateSun();
    shading.horizon.value.set(params.colors.skyHorizon);
    shading.zenith.value.set(params.colors.skyZenith);
    shading.ambient.value.set(params.colors.ambient);
    shading.hazeWater.value = 1 / SKIES[params.sky].hazeWater;
    shading.hazeAir.value = 1 / SKIES[params.sky].hazeAir;
    shading.specBoost.value = SKIES[params.sky].specBoost ?? 0;
    setSkyTexture(params.sky);
    // the sun sliders in the panel follow the new rig
    gui?.controllersRecursive().forEach((ctl) => ctl.updateDisplay());
  }

  // dome radius has to clear the ocean's outer ring; it rides with the camera so
  // the gradient stays centred however far you fly
  const skyDome = createSkyDome(shading, 45000);
  scene.add(skyDome);

  // distance haze — the far ocean fades into the exact sky value behind it
  scene.fogNode = createAerialPerspective(shading, { density: shading.hazeAir });

  const detailTex = makeDetailTexture();

  // FFT-ocean simulation
  const ocean = new Ocean(renderer, params);
  await ocean.updateInitialSpectrum();

  // shaded ocean surface — ~790k-vert radial grid recentred on the camera, dense
  // underfoot and sparse out at 20 km so the water runs to a real horizon
  const oceanSurfaceMat = createOceanSurfaceMaterial(ocean.cascades, { lengthScales: params.lengthScales, shading, detailTex });
  const grid = createRadialGrid({ rings: 620, sectors: 1280, spacing: 0.35, soften: 41 });
  const OCEAN_CELL = grid.innerSpacing; // snap the grid's origin to its own finest step
  const oceanMesh = new Mesh(grid.geometry, oceanSurfaceMat);
  oceanMesh.frustumCulled = false;
  scene.add(oceanMesh);

  const gui = shot ? null : createGUI(params, { ocean, shading, updateSun });
  if (!shot) createPaletteSwitch(params, shading.palette);
  if (!shot) createSkySwitch(params, applySkyLive);

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === '=' || k === '+') ocean.lambda.value = Math.min(ocean.lambda.value + 0.1, 3);
    else if (k === '-' || k === '_') ocean.lambda.value = Math.max(ocean.lambda.value - 0.1, 0);
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // render loop + timing
  let elapsed = 0;
  let last = performance.now();
  let emaWall = 16.7;
  let gpuMs = -1;
  let hudAccum = 1;
  let resolving = false;

  // one simulation step (everything except camera input and drawing), so
  // capture mode can fast-forward on a fixed timestep
  function step(dt) {
    elapsed += dt * params.timeScale;
    ocean.evolve(elapsed, dt * params.timeScale); // foam dissipation tracks time scale
    shading.time.value = elapsed;

    // keep the radial grid centred on the camera; snapping to the finest ring
    // step stops the sampled detail from crawling as it slides
    const ox = Math.round(camera.position.x / OCEAN_CELL) * OCEAN_CELL;
    const oz = Math.round(camera.position.z / OCEAN_CELL) * OCEAN_CELL;
    oceanMesh.position.set(ox, 0, oz);
    shading.originXZ.value.set(ox, oz);
    skyDome.position.copy(camera.position);
  }

  // capture mode: fast-forward the sim in batches, render once, then flag ready
  let warmupLeft = shot ? Math.ceil(shot.time / shot.step) : 0;
  if (shot) {
    renderer.setAnimationLoop(() => {
      for (let i = 0; i < 8 && warmupLeft > 0; i++, warmupLeft--) step(shot.step);
      renderer.render(scene, camera);
      if (warmupLeft <= 0) {
        renderer.setAnimationLoop(null);
        requestAnimationFrame(() => { window.__shotReady = true; });
      }
    });
    return;
  }

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt);
    fly.update(dt);

    renderer.render(scene, camera);

    emaWall = emaWall * 0.9 + dt * 1000 * 0.1;
    hudAccum += dt;
    if (hudAccum >= 0.25) {
      hudAccum = 0;
      if (renderer.backend.trackTimestamp && !resolving) {
        resolving = true;
        renderer.resolveTimestampsAsync('render').then(() => { gpuMs = renderer.info.render.timestamp; }).catch(() => {}).finally(() => { resolving = false; });
      }
      const gpuTxt = gpuMs >= 0 ? `${gpuMs.toFixed(2)} ms GPU/render` : 'GPU ms n/a';
      hud.set(
        `WebGPU · ${(1000 / emaWall).toFixed(0)} fps · ${emaWall.toFixed(2)} ms wall · ${gpuTxt}\n` +
        `step 6 · foam · N=${params.N} · ${ocean.cascades.length} cascades · choppiness λ=${ocean.lambda.value.toFixed(2)} (+/-)\n` +
        `grid: ${(grid.vertexCount / 1000).toFixed(0)}k verts radial · ${(grid.outerRadius / 1000).toFixed(1)} km reach\n` +
        `fly: hold RMB to look · WASD · Q/E down/up · shift boost · wheel speed (${fly.speed.toFixed(0)} m/s)\n` +
        fftStr,
      );
    }
  });
}

main().catch((e) => hud.error(String(e?.stack ?? e)));
