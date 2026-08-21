// Deterministic capture mode, used by tools/shot.mjs to take comparable
// screenshots across iterations. `?shot=1&preset=deck&t=40` runs the sim on a
// fixed timestep to t seconds, renders one frame, then flags window.__shotReady.
//
// URL params, not a config file — the shot script already builds URLs.

// pos + target in world space. Ocean is at y=0, wind blows toward +x/+z (45deg).
export const PRESETS = {
  // signature Sea of Thieves shot: eye just above the water, horizon centred
  deck: { pos: [0, 3.2, 60], target: [0, 2.0, -40], fov: 65 },
  // the reference photograph's viewpoint: a ship's rail ~9 m up, looking
  // slightly down across the near field with the horizon in the upper third
  rail: { pos: [0, 9, 40], target: [0, 0.5, -90], fov: 62 },
  // low and steep over the near surface — texture inspection: tiling repeats
  // and carve microstructure have nowhere to hide at this range
  close: { pos: [0, 7, 10], target: [14, -2, -22], fov: 60 },
  // mid-height survey of the wave field
  swell: { pos: [0, 16, 68], target: [0, 2, -20], fov: 55 },
  // down in a trough looking up at an oncoming crest
  trough: { pos: [-30, 1.4, 20], target: [10, 6, -25], fov: 70 },
  // down the sun's azimuth, whatever sky is active — aimCamera resolves the
  // target from params, with the elevation capped so the sea stays in frame.
  sun: { pos: [0, 6, 0], sunChase: true, fov: 60 },
  // away from the sun — tests body colour + SSS without specular help
  away: { pos: [0, 6, 0], target: [-82.5, 16, 53.1], fov: 60 },
  // under the surface looking up: the only framing that exercises Snell's
  // window and total internal reflection. Wide lens on purpose — the whole sky
  // lands inside a 48-degree cone about the vertical and everything outside it
  // is mirror, so a narrow lens sees only the middle of the window and cannot
  // tell a correct one from a flat plate. Tilted a little off vertical because
  // lookAt straight up is degenerate. Four metres down, which is below any
  // trough this sea state digs: at a metre or two the camera comes up in clear
  // air between crests and the shot is just a photograph of the sky dome.
  under: { pos: [0, -4.0, 0], target: [0, 6, -1.5], fov: 90 },
  // high wide shot: wave-field structure, tiling, distance falloff
  aerial: { pos: [0, 90, 180], target: [0, 0, -60], fov: 55 },
  // grazing horizon shot — catches tile-edge cutoff and aerial perspective
  horizon: { pos: [0, 8, 0], target: [0, 8.2, -200], fov: 45 },
  // eye at wave height: the horizon line has nowhere to hide at 1.6 m
  sealevel: { pos: [0, 1.6, 0], target: [0, 1.75, -400], fov: 55 },
  // long lens down the sun's azimuth — worst case for a visible mesh edge
  glare: { pos: [0, 5, 0], target: [252.2, 22, -162.5], fov: 28 },
  // 10-degree telephoto straight at the horizon line: no mesh edge can hide here
  pinch: { pos: [0, 6, 0], target: [0, 6, -3000], fov: 10 },
  // high and far: proves the water still reaches the horizon from altitude
  vista: { pos: [0, 220, 400], target: [0, 60, -1400], fov: 50 },
};

export function captureConfig() {
  const q = new URLSearchParams(location.search);
  if (!q.get('shot')) return null;
  const preset = PRESETS[q.get('preset')] ?? PRESETS.deck;
  return {
    preset,
    time: Number(q.get('t') ?? 40), // sim seconds to advance before rendering
    step: Number(q.get('step') ?? 1 / 30), // fixed warmup timestep
    overrides: q.get('p') ? JSON.parse(q.get('p')) : null, // deep-merged into params
  };
}

// Apply {"local":{"windSpeed":8}} style overrides so a shot can sweep sea states.
export function applyOverrides(params, overrides) {
  if (!overrides) return;
  for (const [k, v] of Object.entries(overrides)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof params[k] === 'object') applyOverrides(params[k], v);
    else params[k] = v;
  }
}

export function aimCamera(camera, preset, params) {
  camera.position.fromArray(preset.pos);
  camera.fov = preset.fov;
  camera.updateProjectionMatrix();
  if (preset.sunChase && params) {
    // aim along the live sun azimuth at a capped elevation: the glitter path
    // lives on the water BELOW the disc, and chasing a 50-degree midday sun
    // with the lens would frame nothing but sky
    const az = (params.sunAzimuth * Math.PI) / 180;
    const el = Math.min((params.sunElevation * Math.PI) / 180, 0.30);
    camera.lookAt(
      preset.pos[0] + Math.cos(el) * Math.sin(az) * 100,
      preset.pos[1] + Math.sin(el) * 100,
      preset.pos[2] + Math.cos(el) * Math.cos(az) * 100,
    );
    return;
  }
  camera.lookAt(...preset.target);
}
