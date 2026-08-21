// Minimal on-screen HUD + error overlay. Because this build is judged visually
// in the browser (no headless run), the frame time and any WebGPU validation
// errors need to be visible on the page itself.
export function createHUD() {
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.textContent = 'initializing…';
  const err = document.createElement('div');
  err.id = 'err';
  document.body.append(hud, err);

  return {
    set(text) {
      hud.textContent = text;
    },
    error(msg) {
      err.style.display = 'block';
      err.textContent += msg + '\n';
      console.error('[FFT-ocean] ' + msg);
    },
  };
}

// Which sea. Two swatches rather than a slider, because `params.palette` is a
// lerp for implementation reasons only — the two ends are different bodies of
// water and the in-between is not a thing anyone wants to pick by dragging.
//
// Each chip is a gradient from that palette's shadowed trough to its lit crest,
// both sampled from the rendered frame rather than from the linear swatches:
// the swatches are dark enough (Y 0.016-0.44 before exposure and the tone
// curve) that two solid dots of them would be indistinguishable at this size.
const SEAS = [
  { id: 0, name: 'tropical green', from: '#16392e', to: '#5fa986' },
  { id: 1, name: 'open-ocean blue', from: '#1a3342', to: '#6c9eb4' },
];

// Which sky. Same two-chip pattern as the sea palette: the presets are two
// different lighting rigs, not points on a slider. Chips are gradients from
// each sky's zenith down to its horizon.
const SKY_CHIPS = [
  { id: 'midday', name: 'midday', from: '#c2d5eb', to: '#356ace' },
  { id: 'golden', name: 'golden hour', from: '#e8b27a', to: '#7a6f96' },
];

export function createSkySwitch(params, onSelect) {
  const bar = document.createElement('div');
  bar.id = 'sky';
  const chips = SKY_CHIPS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Sky: ' + s.name;
    b.setAttribute('aria-label', 'Sky: ' + s.name);
    b.style.background = 'linear-gradient(180deg, ' + s.to + ', ' + s.from + ')';
    b.addEventListener('click', () => select(s.id));
    bar.append(b);
    return b;
  });

  const mark = () =>
    chips.forEach((b, i) => b.setAttribute('aria-pressed', String(SKY_CHIPS[i].id === params.sky)));

  function select(id) {
    onSelect(id);
    mark();
  }
  mark();

  document.body.append(bar);
  return { select };
}

export function createPaletteSwitch(params, uniformNode) {
  const bar = document.createElement('div');
  bar.id = 'palette';
  const chips = SEAS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `Sea: ${s.name}`;
    b.setAttribute('aria-label', `Sea: ${s.name}`);
    b.style.background = `linear-gradient(135deg, ${s.from}, ${s.to})`;
    b.addEventListener('click', () => select(s.id));
    bar.append(b);
    return b;
  });

  function select(id) {
    params.palette = id;
    uniformNode.value = id;
    chips.forEach((b, i) => b.setAttribute('aria-pressed', String(SEAS[i].id === id)));
  }
  // Round-trips whatever came in, including a `?p={"palette":0.5}` capture
  // override — neither chip lights up at 0.5, which is the honest reading.
  select(params.palette);

  document.body.append(bar);
  return { select };
}
