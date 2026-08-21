import GUI from 'lil-gui';
import { applySpectrumParams } from './ocean/spectrum.js';

// Live control panel. Sea-state changes (wind, amplitude, spread) rebuild the
// initial spectrum h0 on release; everything else just updates a uniform.
export function createGUI(params, { ocean, shading, updateSun }) {
  const gui = new GUI({ title: 'Ocean controls' });

  const recompute = () => {
    applySpectrumParams(ocean.shared, params);
    ocean.updateInitialSpectrum();
  };

  const sea = gui.addFolder('Sea state');
  sea.add(params.local, 'windSpeed', 0, 30, 0.5).name('wind speed (m/s)').onFinishChange(recompute);
  sea.add(params.local, 'windDirection', 0, 360, 1).name('wind direction').onFinishChange(recompute);
  sea.add(params.local, 'scale', 0, 2, 0.02).name('amplitude').onFinishChange(recompute);
  sea.add(params.local, 'spreadBlend', 0, 1, 0.02).name('directionality').onFinishChange(recompute);
  sea.add(params, 'lambda', 0, 2.5, 0.02).name('choppiness').onChange((v) => { ocean.lambda.value = v; });
  sea.add(params, 'timeScale', 0, 3, 0.05).name('time scale');

  const foam = gui.addFolder('Foam');
  foam.add(params, 'foamThreshold', -0.5, 1.5, 0.02).name('threshold').onChange((v) => { shading.foamThreshold.value = v; });
  foam.add(params, 'foamScale', 0.2, 8, 0.1).name('coverage').onChange((v) => { shading.foamScale.value = v; });
  foam.add(params, 'foamDecay', 0.5, 14, 0.5).name('wake e-fold (s)').onChange((v) => { ocean.foamDecay.value = v; });
  // one dial per appearance item, all of them zeroable so each can be checked
  // in isolation against a shot
  foam.add(params, 'foamSpread', 0, 4, 0.02).name('wake spread (1/s)').onChange((v) => { ocean.foamSpread.value = v; });
  foam.add(params, 'foamBright', 0.2, 1.4, 0.02).name('brightness').onChange((v) => { shading.foamBright.value = v; });
  foam.add(params, 'foamRelief', 0, 0.4, 0.005).name('micro-relief').onChange((v) => { shading.foamRelief.value = v; });
  foam.add(params, 'foamMilk', 0, 0.8, 0.02).name('plume milkiness').onChange((v) => { shading.foamMilk.value = v; });

  const surf = gui.addFolder('Surface');
  surf.add(params, 'detailStrength', 0, 0.5, 0.01).name('detail noise').onChange((v) => { shading.detail.value = v; });
  surf.add(params, 'sssStrength', 0, 3, 0.05).name('subsurface').onChange((v) => { shading.sssStrength.value = v; });

  const sky = gui.addFolder('Sun & sky');
  sky.add(params, 'sunAzimuth', 0, 360, 1).name('sun azimuth').onChange(updateSun);
  sky.add(params, 'sunElevation', 0, 90, 1).name('sun elevation').onChange(updateSun);
  sky.add(params, 'sunIntensity', 0, 8, 0.05).name('sun intensity').onChange(updateSun);

  const col = gui.addFolder('Colors').close();
  const color = (key, uni) => col.addColor(params.colors, key).onChange(() => uni.value.setHex(params.colors[key]));
  color('deep', shading.deepColor);
  color('scatter', shading.scatterColor);
  color('foam', shading.foamColor);
  color('skyHorizon', shading.horizon);
  color('skyZenith', shading.zenith);
  // sun is not a swatch the material reads directly — it is multiplied by
  // sunIntensity into a radiance, so it goes back through updateSun()
  col.addColor(params.colors, 'sun').name('sun (match the sky)').onChange(updateSun);

  return gui;
}
