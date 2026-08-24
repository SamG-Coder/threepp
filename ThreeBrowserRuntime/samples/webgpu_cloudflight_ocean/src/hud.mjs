import * as THREE from "three/webgpu";

// A deliberately tiny aviation-style bitmap alphabet. Every glyph is generated
// into a DataTexture; no DOM, Canvas2D, system font or downloaded asset enters
// the presentation path.
const GLYPHS = Object.freeze({
  " ": ["000", "000", "000", "000", "000"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["110", "001", "010", "100", "111"],
  3: ["110", "001", "010", "001", "110"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "110", "001", "110"],
  6: ["011", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "110"],
  ":": ["000", "010", "000", "010", "000"],
  ".": ["000", "000", "000", "000", "010"],
  ",": ["000", "000", "000", "010", "100"],
  "-": ["000", "000", "111", "000", "000"],
  "/": ["001", "001", "010", "100", "100"],
  "+": ["000", "010", "111", "010", "000"],
  "%": ["101", "001", "010", "100", "101"],
  "=": ["000", "111", "000", "111", "000"],
  "?": ["110", "001", "010", "000", "010"],
});

const CELL_WIDTH = 5;
const ATLAS_WIDTH = 256;
const ATLAS_HEIGHT = 8;
const HUD_ORDER = 2000;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function createFontAtlas() {
  const bytes = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const cells = new Map();
  let cell = 0;
  for (const [character, rows] of Object.entries(GLYPHS)) {
    const originX = cell * CELL_WIDTH;
    cells.set(character, originX);
    for (let row = 0; row < 5; ++row) {
      for (let column = 0; column < 3; ++column) {
        if (rows[row][column] !== "1") continue;
        const offset = ((row + 1) * ATLAS_WIDTH + originX + column + 1) * 4;
        bytes[offset] = 255;
        bytes[offset + 1] = 255;
        bytes[offset + 2] = 255;
        bytes[offset + 3] = 255;
      }
    }
    cell += 1;
  }

  const texture = new THREE.DataTexture(
    bytes,
    ATLAS_WIDTH,
    ATLAS_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "Cloudflight JS bitmap avionics atlas";
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, cells };
}

function makeDynamicText(atlas, maximumCharacters, color, pixelSize = 2, opacity = 1) {
  const capacity = Math.max(1, Math.floor(maximumCharacters));
  const glyphWidth = 3 * pixelSize;
  const glyphHeight = 5 * pixelSize;
  const advance = 4 * pixelSize;
  const positions = new Float32Array(capacity * 4 * 3);
  const uvs = new Float32Array(capacity * 4 * 2);
  const indices = new Uint32Array(capacity * 6);

  for (let index = 0; index < capacity; ++index) {
    const x = index * advance;
    const vertex = index * 4;
    positions.set([
      x, 0, 0,
      x + glyphWidth, 0, 0,
      x + glyphWidth, glyphHeight, 0,
      x, glyphHeight, 0,
    ], vertex * 3);
    indices.set([
      vertex, vertex + 1, vertex + 2,
      vertex, vertex + 2, vertex + 3,
    ], index * 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(capacity * advance * 0.5, glyphHeight * 0.5, 0),
    capacity * advance,
  );

  const material = new THREE.MeshBasicNodeMaterial({
    map: atlas.texture,
    color,
    transparent: true,
    opacity,
    alphaTest: 0.40,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.name = "Cloudflight bitmap HUD text";
  material.toneMapped = false;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = HUD_ORDER + 3;
  mesh.frustumCulled = false;
  mesh.userData.text = "";
  mesh.userData.width = 0;
  mesh.userData.height = glyphHeight;

  mesh.setText = nextValue => {
    const next = String(nextValue ?? "").toUpperCase().slice(0, capacity);
    if (next === mesh.userData.text) return false;
    mesh.userData.text = next;
    mesh.userData.width = Math.max(0, next.length * advance - pixelSize);
    for (let index = 0; index < next.length; ++index) {
      const character = GLYPHS[next[index]] ? next[index] : "?";
      const originX = atlas.cells.get(character) ?? atlas.cells.get("?");
      const u0 = (originX + 1) / ATLAS_WIDTH;
      const u1 = (originX + 4) / ATLAS_WIDTH;
      const v0 = 1 / ATLAS_HEIGHT;
      const v1 = 6 / ATLAS_HEIGHT;
      uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], index * 8);
    }
    geometry.attributes.uv.needsUpdate = true;
    geometry.setDrawRange(0, next.length * 6);
    return true;
  };

  mesh.setColor = nextColor => {
    material.color.set(nextColor);
  };

  return mesh;
}

function makePanel(width, height, color, opacity, order = HUD_ORDER) {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.name = "Cloudflight HUD panel";
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  mesh.userData.width = width;
  mesh.userData.height = height;
  return mesh;
}

function placePanel(mesh, x, y, z = 0) {
  mesh.position.set(x + mesh.userData.width * 0.5, y + mesh.userData.height * 0.5, z);
}

function angleDegrees(source, degreeNames, radianNames, fallback = 0) {
  for (const name of degreeNames) {
    if (Number.isFinite(Number(source?.[name]))) return Number(source[name]);
  }
  for (const name of radianNames) {
    if (Number.isFinite(Number(source?.[name]))) return THREE.MathUtils.radToDeg(Number(source[name]));
  }
  return fallback;
}

function paddedInteger(value, digits) {
  return Math.max(0, Math.round(finite(value))).toString().padStart(digits, "0");
}

function signedInteger(value, digits) {
  const number = Math.round(finite(value));
  const sign = number >= 0 ? "+" : "-";
  return `${sign}${Math.abs(number).toString().padStart(digits, "0")}`;
}

/**
 * Create a canvas-only flight HUD.
 *
 * `update()` accepts either a flat object or `{ flight, weather }`. Flight
 * values are SI (`airspeedMps`, `altitudeM`, `verticalSpeedMps`) and angles can
 * be provided as explicit `*Degrees`/`*Radians`. The display converts to the
 * aviation-standard knots, feet and feet/minute.
 */
export function createFlightHud(rendererOrOptions) {
  const options = rendererOrOptions?.domElement
    ? { renderer: rendererOrOptions }
    : (rendererOrOptions ?? {});
  const renderer = options.renderer;
  if (!renderer?.render) throw new TypeError("createFlightHud requires a Three.js renderer.");

  const atlas = createFontAtlas();
  const scene = new THREE.Scene();
  scene.name = "Cloudflight JS-only orthographic flight HUD";
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  camera.position.z = 5;
  // Keep the HUD away from the swapchain. The flight world and UI are
  // composited together by main.mjs in one final canvas submission, avoiding
  // competing presents and intermittent black native WebGPU frames.
  const target = new THREE.RenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  target.texture.name = "Cloudflight transparent JS HUD";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  const root = new THREE.Group();
  root.name = "Cloudflight flight instruments and telemetry";
  scene.add(root);

  const titleGroup = new THREE.Group();
  const telemetryGroup = new THREE.Group();
  const weatherGroup = new THREE.Group();
  const attitudeGroup = new THREE.Group();
  const headingGroup = new THREE.Group();
  const footerGroup = new THREE.Group();
  root.add(titleGroup, telemetryGroup, weatherGroup, attitudeGroup, headingGroup, footerGroup);

  const titlePanel = makePanel(378, 66, 0x020b12, 0.68);
  const titleAccent = makePanel(5, 66, 0x67f5df, 0.96, HUD_ORDER + 2);
  const title = makeDynamicText(atlas, 30, 0xe6fffa, 3, 1);
  const subtitle = makeDynamicText(atlas, 44, 0x82b5c0, 2, 0.92);
  title.setText("CLOUD FLIGHT // PILOT");
  subtitle.setText("PROCEDURAL WEATHER + OPEN OCEAN");
  placePanel(titlePanel, 0, 0);
  placePanel(titleAccent, 0, 0, 0.1);
  title.position.set(20, 15, 0.3);
  subtitle.position.set(20, 42, 0.3);
  titleGroup.add(titlePanel, titleAccent, title, subtitle);

  const telemetryPanel = makePanel(236, 174, 0x020b12, 0.60);
  const telemetryAccent = makePanel(236, 2, 0x5de3d5, 0.55, HUD_ORDER + 2);
  placePanel(telemetryPanel, 0, 0);
  placePanel(telemetryAccent, 0, 0, 0.1);
  const speedText = makeDynamicText(atlas, 21, 0xd9fff7, 3, 1);
  const altitudeText = makeDynamicText(atlas, 21, 0xd9fff7, 3, 1);
  const verticalSpeedText = makeDynamicText(atlas, 22, 0x8ce9dc, 2, 0.96);
  const throttleText = makeDynamicText(atlas, 22, 0xa9cbd0, 2, 0.92);
  const flightModeText = makeDynamicText(atlas, 24, 0x66f1d8, 2, 0.98);
  speedText.position.set(15, 18, 0.3);
  altitudeText.position.set(15, 51, 0.3);
  verticalSpeedText.position.set(15, 87, 0.3);
  throttleText.position.set(15, 111, 0.3);
  flightModeText.position.set(15, 146, 0.3);
  const throttleTrack = makePanel(202, 5, 0x17323a, 0.88, HUD_ORDER + 1);
  const throttleFill = makePanel(202, 5, 0x55e5ce, 0.96, HUD_ORDER + 2);
  placePanel(throttleTrack, 15, 132, 0.1);
  placePanel(throttleFill, 15, 132, 0.2);
  telemetryGroup.add(
    telemetryPanel,
    telemetryAccent,
    speedText,
    altitudeText,
    verticalSpeedText,
    throttleText,
    flightModeText,
    throttleTrack,
    throttleFill,
  );

  const weatherPanel = makePanel(284, 174, 0x020b12, 0.60);
  const weatherAccent = makePanel(5, 174, 0x66b8df, 0.85, HUD_ORDER + 2);
  placePanel(weatherPanel, 0, 0);
  placePanel(weatherAccent, 0, 0, 0.1);
  const weatherTitle = makeDynamicText(atlas, 31, 0xd7f2f6, 2, 1);
  const cloudText = makeDynamicText(atlas, 32, 0x9ed3dd, 2, 0.95);
  const visibilityText = makeDynamicText(atlas, 32, 0x9ed3dd, 2, 0.95);
  const windText = makeDynamicText(atlas, 32, 0x9ed3dd, 2, 0.95);
  const precipitationText = makeDynamicText(atlas, 32, 0x85cde2, 2, 0.98);
  const performanceText = makeDynamicText(atlas, 32, 0x6f929d, 2, 0.88);
  weatherTitle.position.set(18, 16, 0.3);
  cloudText.position.set(18, 45, 0.3);
  visibilityText.position.set(18, 69, 0.3);
  windText.position.set(18, 93, 0.3);
  precipitationText.position.set(18, 117, 0.3);
  performanceText.position.set(18, 145, 0.3);
  weatherGroup.add(
    weatherPanel,
    weatherAccent,
    weatherTitle,
    cloudText,
    visibilityText,
    windText,
    precipitationText,
    performanceText,
  );

  const headingPanel = makePanel(174, 38, 0x020b12, 0.61);
  placePanel(headingPanel, 0, 0);
  const headingText = makeDynamicText(atlas, 18, 0xe8fff9, 2, 1);
  headingText.position.set(17, 14, 0.3);
  headingGroup.add(headingPanel, headingText);

  // Central attitude director. The horizon moves and rolls while the aircraft
  // symbol remains fixed, matching a conventional attitude indicator.
  const horizon = new THREE.Group();
  horizon.name = "HUD moving horizon";
  const horizonLine = makePanel(270, 2, 0x7bded4, 0.82, HUD_ORDER + 1);
  placePanel(horizonLine, -135, -1, 0.1);
  horizon.add(horizonLine);
  for (const offset of [-60, -30, 30, 60]) {
    const pitchLine = makePanel(Math.abs(offset) === 60 ? 72 : 104, 1, 0x71b9b6, 0.62, HUD_ORDER + 1);
    placePanel(pitchLine, -pitchLine.userData.width * 0.5, offset, 0.1);
    horizon.add(pitchLine);
  }
  const reticleLeft = makePanel(68, 3, 0xf0c36e, 0.96, HUD_ORDER + 3);
  const reticleRight = makePanel(68, 3, 0xf0c36e, 0.96, HUD_ORDER + 3);
  const reticleStem = makePanel(3, 18, 0xf0c36e, 0.96, HUD_ORDER + 3);
  placePanel(reticleLeft, -78, -1.5, 0.3);
  placePanel(reticleRight, 10, -1.5, 0.3);
  placePanel(reticleStem, -1.5, -1.5, 0.3);
  const flightPathMarker = new THREE.Group();
  flightPathMarker.name = "Flight path marker";
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(10, 12, 28),
    new THREE.MeshBasicNodeMaterial({
      color: 0x74f4df,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  markerRing.material.toneMapped = false;
  markerRing.renderOrder = HUD_ORDER + 3;
  markerRing.frustumCulled = false;
  flightPathMarker.add(markerRing);
  const vsiTrack = makePanel(3, 120, 0x436a70, 0.62, HUD_ORDER + 1);
  const vsiMarker = makePanel(20, 3, 0xffbd62, 0.95, HUD_ORDER + 3);
  placePanel(vsiTrack, 194, -60, 0.1);
  placePanel(vsiMarker, 185, -1.5, 0.3);
  attitudeGroup.add(horizon, reticleLeft, reticleRight, reticleStem, flightPathMarker, vsiTrack, vsiMarker);

  const footer = makeDynamicText(atlas, 110, 0x82a1a9, 2, 0.88);
  footer.setText("W/S PITCH  A/D BANK  Q/E RUDDER  WHEEL OR +/- POWER  F AUTOPILOT  C WEATHER  R RAIN  L LIGHTNING  H HUD");
  footerGroup.add(footer);

  let width = 1;
  let height = 1;
  let scale = 1;
  let visible = true;
  let state = {};

  function resize(nextWidth, nextHeight) {
    width = Math.max(1, finite(nextWidth, 1));
    height = Math.max(1, finite(nextHeight, 1));
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    target.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

    scale = clamp(Math.min(width / 1280, height / 720), 0.72, 1.45);
    for (const group of [titleGroup, telemetryGroup, weatherGroup, attitudeGroup, headingGroup, footerGroup]) {
      group.scale.setScalar(scale);
    }
    const margin = 22 * scale;
    titleGroup.position.set(margin, margin, 0);
    telemetryGroup.position.set(margin, height * 0.50 - 87 * scale, 0);
    weatherGroup.position.set(width - margin - 284 * scale, margin, 0);
    headingGroup.position.set(width * 0.5 - 87 * scale, margin, 0);
    attitudeGroup.position.set(width * 0.5, height * 0.54, 0);
    footerGroup.position.set(margin, height - 28 * scale, 0);

    const compact = width < 830 || height < 470;
    weatherGroup.visible = !compact;
    subtitle.visible = width >= 600;
    footer.visible = width >= 720;
  }

  function update(next = {}) {
    state = { ...state, ...next };
    const flight = next.flight && typeof next.flight === "object" ? next.flight : next;
    const weather = next.weather && typeof next.weather === "object" ? next.weather : next;
    const controls = next.controls ?? flight.controls ?? flight;

    const airspeedMps = Math.max(0, finite(flight.airspeedMps ?? flight.airspeed ?? flight.speed, 0));
    const altitudeM = Math.max(0, finite(flight.altitudeM ?? flight.altitude ?? flight.position?.y, 0));
    const verticalSpeedMps = finite(flight.verticalSpeedMps ?? flight.verticalSpeed, 0);
    const throttle = clamp(finite(controls.throttle ?? flight.throttle, 0), 0, 1);
    const heading = ((angleDegrees(
      flight,
      ["headingDegrees", "headingDeg", "heading"],
      ["headingRadians", "yawRadians", "yaw"],
      0,
    ) % 360) + 360) % 360;
    const pitchDegrees = angleDegrees(flight, ["pitchDegrees", "pitchDeg"], ["pitchRadians", "pitch"], 0);
    const rollDegrees = angleDegrees(
      flight,
      ["rollDegrees", "rollDeg", "bankDegrees", "bankDeg"],
      ["rollRadians", "bankRadians", "roll", "bank"],
      0,
    );
    const autopilot = Boolean(flight.autopilot ?? flight.autoPilot ?? next.autopilot);

    const weatherLabel = String(
      next.weatherLabel
      ?? weather.label
      ?? weather.name
      ?? (typeof next.weather === "string" ? next.weather : "MARINE CUMULUS"),
    ).toUpperCase();
    const cloudBaseM = Math.max(0, finite(weather.cloudBaseM ?? weather.cloudBase, 850));
    const cloudCoverage = clamp(finite(weather.cloudCoverage ?? weather.coverage, 0.55), 0, 1);
    const visibilityKm = Math.max(0, finite(weather.visibilityKm ?? weather.visibility, 24));
    const rainIntensity = clamp(finite(
      weather.rainIntensity ?? weather.precipitation ?? next.rain,
      0,
    ), 0, 1);
    let vectorWindSpeed = 0;
    if (weather.wind?.isVector3) vectorWindSpeed = weather.wind.length();
    else if (Array.isArray(weather.wind) || ArrayBuffer.isView(weather.wind)) {
      vectorWindSpeed = Math.hypot(...weather.wind.slice(0, 3).map(Number));
    }
    const windSpeedMps = Math.max(0, finite(
      weather.windSpeedMps ?? weather.windSpeed,
      vectorWindSpeed,
    ));
    const windDirection = ((finite(weather.windDirectionDegrees ?? weather.windDirection, 240) % 360) + 360) % 360;
    const fps = Math.max(0, finite(next.fps ?? next.performance?.fps, 0));
    const renderScale = clamp(finite(next.renderScale ?? next.performance?.renderScale, 1), 0, 9.99);

    speedText.setText(`SPD ${paddedInteger(airspeedMps * 1.943844, 3)} KT`);
    altitudeText.setText(`ALT ${paddedInteger(altitudeM * 3.28084, 5)} FT`);
    verticalSpeedText.setText(`V/S ${signedInteger(verticalSpeedMps * 196.8504, 4)} FPM`);
    throttleText.setText(`POWER ${paddedInteger(throttle * 100, 3)}%`);
    flightModeText.setText(autopilot ? "AUTOPILOT // ROUTE" : "MANUAL FLIGHT");
    flightModeText.setColor(autopilot ? 0x65f0d7 : 0xffc467);
    headingText.setText(`HDG ${paddedInteger(heading, 3)} DEG`);

    weatherTitle.setText(`WX // ${weatherLabel}`);
    cloudText.setText(`BASE ${paddedInteger(cloudBaseM * 3.28084, 5)} FT  COV ${paddedInteger(cloudCoverage * 100, 3)}%`);
    visibilityText.setText(`VIS ${visibilityKm.toFixed(1)} KM`);
    windText.setText(`WIND ${paddedInteger(windDirection, 3)}/${paddedInteger(windSpeedMps * 1.943844, 2)} KT`);
    precipitationText.setText(`RAIN ${paddedInteger(rainIntensity * 100, 3)}%`);
    precipitationText.setColor(rainIntensity > 0.62 ? 0xffbc67 : 0x85cde2);
    const runtimeLabel = String(next.runtime ?? next.performance?.runtime ?? "").toUpperCase();
    performanceText.setText(runtimeLabel
      ? `PATH ${runtimeLabel}`
      : `FPS ${paddedInteger(fps, 3)}  SCALE ${renderScale.toFixed(2)}`);

    throttleFill.scale.x = Math.max(0.001, throttle);
    throttleFill.position.x = 15 + 202 * throttle * 0.5;
    horizon.rotation.z = THREE.MathUtils.degToRad(rollDegrees);
    horizon.position.y = clamp(pitchDegrees * 3.2, -92, 92);
    vsiMarker.position.y = clamp(-verticalSpeedMps / 15, -1, 1) * 60;
    flightPathMarker.position.set(
      clamp(finite(flight.slip ?? flight.flightPathX, 0) * 42, -84, 84),
      clamp(-finite(flight.angleOfAttack ?? flight.flightPathY, 0) * 40, -62, 62),
      0,
    );
  }

  function setVisible(next) {
    visible = Boolean(next);
    root.visible = visible;
    return visible;
  }

  const initial = renderer.getSize?.(new THREE.Vector2()) ?? new THREE.Vector2(1, 1);
  resize(initial.x, initial.y);
  update(options.initialState ?? {});

  return {
    scene,
    camera,
    root,
    target,
    get texture() {
      return target.texture;
    },
    resize,
    update,
    setState: update,
    setVisible,
    toggleVisible() {
      return setVisible(!visible);
    },
    renderToTexture() {
      const previousTarget = renderer.getRenderTarget();
      const previousMrt = renderer.getMRT();
      const previousClearColor = renderer.getClearColor(new THREE.Color());
      const previousClearAlpha = renderer.getClearAlpha();
      const previousAutoClear = renderer.autoClear;
      try {
        renderer.setMRT(null);
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        renderer.clear(true, false, false);
        if (visible) renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setMRT(previousMrt);
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.autoClear = previousAutoClear;
      }
      return target.texture;
    },
    render() {
      if (!visible) return false;
      const previousAutoClear = renderer.autoClear;
      try {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = previousAutoClear;
      }
      return true;
    },
    dispose() {
      atlas.texture.dispose();
      target.dispose();
      const geometries = new Set();
      const materials = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) if (material) materials.add(material);
      });
      geometries.forEach(geometry => geometry.dispose?.());
      materials.forEach(material => material.dispose?.());
      geometries.clear();
      materials.clear();
      root.clear();
    },
  };
}
