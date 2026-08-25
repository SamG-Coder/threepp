const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

export const MERCURY_BASS_TRACK = Object.freeze({
  sampleRate: 48_000,
  durationSeconds: 96,
  url: new URL("../assets/mercury-sub-bass.wav", import.meta.url).href,
});

const SECTION_BLUEPRINTS = [
  { name: "atmospheric-intro", start: 0, end: 15, bpmStart: 58, bpmEnd: 66, subdivision: 1 },
  { name: "accelerating-build", start: 15, end: 31, bpmStart: 72, bpmEnd: 112, subdivision: 2 },
  { name: "main-drop", start: 31, end: 51, bpmStart: 118, bpmEnd: 124, subdivision: 4 },
  { name: "half-time-breakdown", start: 51, end: 67, bpmStart: 68, bpmEnd: 74, subdivision: 1 },
  { name: "second-variation-final-lift", start: 67, end: 85, bpmStart: 126, bpmEnd: 134, subdivision: 4 },
  { name: "long-decay-outro", start: 85, end: 96, bpmStart: 72, bpmEnd: 54, subdivision: 1 },
];

let cumulativeBeat = 0;
export const MERCURY_SONG_SECTIONS = Object.freeze(SECTION_BLUEPRINTS.map(section => {
  const duration = section.end - section.start;
  const beatCount = duration * (section.bpmStart + section.bpmEnd) / 120;
  const result = Object.freeze({ ...section, beatOffset: cumulativeBeat, beatCount });
  cumulativeBeat += beatCount;
  return result;
}));

export function mercurySongPosition(seconds = 0) {
  const duration = MERCURY_BASS_TRACK.durationSeconds;
  const wrapped = ((Number(seconds) || 0) % duration + duration) % duration;
  const section = MERCURY_SONG_SECTIONS.find(value => wrapped < value.end) ??
    MERCURY_SONG_SECTIONS.at(-1);
  const localSeconds = wrapped - section.start;
  const sectionDuration = section.end - section.start;
  const progress = localSeconds / sectionDuration;
  const bpmDelta = section.bpmEnd - section.bpmStart;
  const localBeat = (
    section.bpmStart * localSeconds +
    0.5 * bpmDelta * localSeconds * localSeconds / sectionDuration
  ) / 60;
  return Object.freeze({
    seconds: wrapped,
    section,
    progress,
    bpm: section.bpmStart + bpmDelta * progress,
    localBeat,
    beat: section.beatOffset + localBeat,
  });
}

// Absolute-second placements make the tempo changes explicit. Density rises
// through each build, opens into half-time, then accelerates into a different
// final phrase rather than repeating the first drop.
const CUE_PLANS = [
  ["atmospheric-intro", [
    [1.40, 0.55, 1], [4.80, 0.62, 1], [8.30, 0.76, 2],
    [11.60, 0.58, 1], [13.80, 0.84, 2], [14.65, 0.66, 1],
  ]],
  ["accelerating-build", [
    [15.45, 0.60, 1], [17.60, 0.64, 1], [19.42, 0.68, 1],
    [21.02, 0.72, 1], [22.42, 0.76, 1], [23.65, 0.70, 1],
    [24.72, 0.82, 2], [24.72, 0.58, 1], [25.70, 0.73, 1],
    [26.58, 0.80, 1], [27.38, 0.76, 1], [28.12, 0.84, 2],
    [28.80, 0.72, 1], [29.40, 0.82, 1], [29.94, 0.78, 1],
    [30.40, 0.90, 2], [30.40, 0.62, 1], [30.76, 0.84, 1],
  ]],
  ["main-drop", [
    [31.00, 1.00, 3], [31.00, 0.84, 2], [31.52, 0.74, 1],
    [32.03, 0.82, 1], [32.77, 0.70, 1], [33.28, 0.88, 2],
    [34.03, 0.96, 2], [34.03, 0.68, 1], [34.56, 0.76, 1],
    [35.29, 0.84, 1], [35.80, 0.72, 1], [36.31, 0.90, 2],
    [37.08, 0.94, 2], [37.08, 0.66, 1], [37.60, 0.78, 1],
    [38.36, 0.86, 1], [38.88, 0.74, 1], [39.38, 1.00, 3],
    [39.38, 0.82, 2], [40.14, 0.76, 1], [40.66, 0.88, 1],
    [41.42, 0.72, 1], [41.94, 0.84, 2], [42.46, 0.92, 2],
    [42.46, 0.64, 1], [43.21, 0.78, 1], [43.72, 0.86, 1],
    [44.24, 0.74, 1], [45.01, 0.96, 2], [45.01, 0.68, 1],
    [45.52, 0.80, 1], [46.29, 0.88, 2], [46.80, 0.73, 1],
    [47.31, 1.00, 3], [47.31, 0.84, 2], [48.08, 0.77, 1],
    [48.60, 0.86, 1], [49.36, 0.72, 1], [49.88, 0.90, 2],
    [50.38, 0.82, 1], [50.38, 0.62, 1],
  ]],
  ["half-time-breakdown", [
    [51.65, 0.62, 1], [53.85, 0.70, 1], [56.40, 0.88, 2],
    [58.92, 0.66, 1], [61.20, 0.74, 1], [63.72, 0.92, 2],
    [65.32, 0.68, 1], [66.42, 0.82, 2],
  ]],
  ["second-variation-final-lift", [
    [67.00, 1.00, 3], [67.00, 0.86, 2], [67.45, 0.78, 1],
    [67.90, 0.72, 1], [68.58, 0.88, 2], [69.04, 0.76, 1],
    [69.72, 0.94, 2], [69.72, 0.66, 1], [70.18, 0.82, 1],
    [70.86, 0.74, 1], [71.31, 0.90, 2], [71.99, 0.78, 1],
    [72.45, 0.96, 2], [72.45, 0.68, 1], [73.13, 0.84, 1],
    [73.58, 0.76, 1], [74.26, 0.88, 2], [74.72, 0.80, 1],
    [75.40, 1.00, 3], [75.40, 0.86, 2], [75.85, 0.74, 1],
    [76.53, 0.90, 2], [76.99, 0.78, 1], [77.67, 0.94, 2],
    [77.67, 0.65, 1], [78.12, 0.82, 1], [78.80, 0.74, 1],
    [79.26, 0.88, 2], [79.94, 0.80, 1], [80.39, 0.96, 2],
    [80.39, 0.68, 1], [81.07, 0.84, 1], [81.53, 0.76, 1],
    [82.21, 0.92, 2], [82.67, 0.80, 1], [83.35, 1.00, 3],
    [83.35, 0.84, 2], [83.80, 0.76, 1], [84.48, 0.90, 2],
    [84.48, 0.64, 1],
  ]],
  ["long-decay-outro", [
    [85.20, 0.82, 2], [86.10, 0.72, 1], [87.22, 0.68, 1],
    [88.52, 0.88, 2], [89.92, 0.64, 1], [91.42, 0.72, 1],
    [93.02, 0.82, 2], [94.34, 0.62, 1], [95.12, 0.70, 1],
  ]],
];

let nextCueId = 1;
export const MERCURY_BASS_CUES = Object.freeze(CUE_PLANS.flatMap(
  ([section, entries], sectionIndex) => entries.map(([timeSeconds, strength, tier]) => {
    const cueId = nextCueId++;
    const angle = cueId * 2.399963229728653 + sectionIndex * 0.61;
    const radiusUnit = 0.22 + ((cueId * 0.61803398875) % 1) * 0.36;
    const radius = tier === 3 ? 0.50 : tier === 2 ? 0.43 : 0.29 + strength * 0.09;
    return Object.freeze({
      cueId,
      section,
      timeSeconds,
      x: Math.cos(angle) * radiusUnit,
      z: Math.sin(angle) * radiusUnit * 0.94,
      strength,
      tier,
      radius,
    });
  }),
));

const CUE_BY_ID = new Map(MERCURY_BASS_CUES.map(cue => [cue.cueId, cue]));

export function bassCueDescriptor(cueId) {
  const numericId = Math.trunc(Number(cueId));
  return CUE_BY_ID.get(numericId) ?? null;
}

export function mapBassCueToMercuryShock(model, packet) {
  if (!model || typeof model.disturb !== "function") {
    throw new TypeError("A MercuryPoolModel-compatible model is required.");
  }
  const cue = bassCueDescriptor(packet?.cueId);
  if (!cue) return null;

  const radius = clamp(cue.radius * 1.12, 0.30, 0.52);
  const centerX = model.originX + model.poolWidth * 0.5;
  const centerZ = model.originZ + model.poolDepth * 0.5;
  const safeHalfWidth = Math.max(0, model.poolWidth * 0.5 - radius * 1.15);
  const safeHalfDepth = Math.max(0, model.poolDepth * 0.5 - radius * 1.15);
  const strength = clamp(cue.strength, 0, 1);
  const tier = Math.max(1, Math.min(3, Math.trunc(cue.tier || 1)));
  const amplitude = tier === 3
    ? 0.070
    : tier === 2
      ? 0.025 + Math.pow(strength, 1.16) * 0.041
      : 0.017 + Math.pow(strength, 1.24) * 0.038;
  const liftAmplitude = tier === 3
    ? amplitude * 0.82
    : tier === 2
      ? amplitude * 0.30
      : 0;
  const recoilAmplitude = amplitude * (tier === 3 ? 0.52 : tier === 2 ? 0.38 : 0.28);

  const sampleRate = Math.max(1, Number(packet?.sampleRate) || MERCURY_BASS_TRACK.sampleRate);
  const cueSample = Number.isFinite(Number(packet?.absoluteSample))
    ? Number(packet.absoluteSample)
    : Number(packet?.sampleFrame);
  const playheadSample = Number(packet?.playheadSample);
  const secondsAhead = Number.isFinite(cueSample) && Number.isFinite(playheadSample)
    ? Math.max(0, (cueSample - playheadSample) / sampleRate)
    : 0;
  const atTick = model.tick + Math.max(
    0,
    Math.round(secondsAhead / model.fixedStepSeconds),
  );

  return Object.freeze({
    cueId: cue.cueId,
    loop: Math.max(0, Math.trunc(Number(packet?.loop) || 0)),
    x: centerX + cue.x * safeHalfWidth,
    z: centerZ + cue.z * safeHalfDepth,
    amplitude,
    radius,
    tier,
    atTick,
    liftAmplitude,
    liftTick: atTick + 1,
    recoilAmplitude,
    recoilTick: atTick + 4,
  });
}

export function applyBassCueToMercury(model, packet) {
  const shock = mapBassCueToMercuryShock(model, packet);
  if (!shock) return null;

  // Major accents push twice across adjacent fixed ticks, producing a near-
  // jumping mound while it is still one connected conservative liquid mesh.
  model.disturb(
    shock.x,
    shock.z,
    shock.amplitude,
    shock.radius,
    shock.atTick,
  );
  if (shock.liftAmplitude > 0) {
    model.disturb(
      shock.x,
      shock.z,
      shock.liftAmplitude,
      shock.radius * (shock.tier === 3 ? 0.82 : 0.90),
      shock.liftTick,
    );
  }
  // The opposite-polarity half-cycle turns the lift into a travelling ring.
  model.disturb(
    shock.x,
    shock.z,
    -shock.recoilAmplitude,
    shock.radius * 1.08,
    shock.recoilTick,
  );
  return shock;
}

export function createMercuryBassController({
  model,
  audioFactory = source => new globalThis.Audio(source),
  source = MERCURY_BASS_TRACK.url,
  volume = 0.88,
} = {}) {
  if (!model || typeof model.disturb !== "function") {
    throw new TypeError("createMercuryBassController requires the mercury model.");
  }
  const audio = audioFactory(source);
  if (!audio) throw new Error("The native audio element could not be created.");
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = clamp(volume, 0, 1);

  let disposed = false;
  let lastError = null;
  let cueCount = 0;
  let shockCount = 0;
  let lastCueId = 0;
  let lastLoop = 0;
  const seen = new Set();

  function play() {
    if (disposed) return Promise.resolve(false);
    try {
      const result = audio.play?.();
      return Promise.resolve(result).then(
        () => true,
        error => {
          lastError = error?.message || String(error);
          return false;
        },
      );
    } catch (error) {
      lastError = error?.message || String(error);
      return Promise.resolve(false);
    }
  }

  function pause() {
    if (!disposed) audio.pause?.();
  }

  function poll() {
    if (disposed || audio.paused || typeof audio.pollCues !== "function") return 0;
    let packets;
    try {
      packets = audio.pollCues(0);
    } catch (error) {
      lastError = error?.message || String(error);
      return 0;
    }
    if (!Array.isArray(packets)) return 0;

    let applied = 0;
    for (const packet of packets) {
      cueCount += 1;
      const sequence = Number(packet?.sequence);
      const key = Number.isFinite(sequence)
        ? `s:${sequence}`
        : `c:${Math.trunc(Number(packet?.loop) || 0)}:${Math.trunc(Number(packet?.cueId) || 0)}:${Math.trunc(Number(packet?.sampleFrame) || 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 512) {
        const oldest = seen.values().next().value;
        seen.delete(oldest);
      }
      const shock = applyBassCueToMercury(model, packet);
      if (!shock) continue;
      applied += 1;
      shockCount += 1;
      lastCueId = shock.cueId;
      lastLoop = shock.loop;
    }
    return applied;
  }

  function restart() {
    if (disposed) return Promise.resolve(false);
    pause();
    try {
      audio.currentTime = 0;
    } catch {
      // A host already shutting down may reject its final seek.
    }
    seen.clear();
    return play();
  }

  function dispose() {
    if (disposed) return;
    pause();
    audio.src = "";
    seen.clear();
    disposed = true;
  }

  function status() {
    return Object.freeze({
      available: typeof audio.pollCues === "function",
      playing: !disposed && !audio.paused,
      cueCount,
      shockCount,
      lastCueId,
      lastLoop,
      currentTime: Number(audio.currentTime) || 0,
      error: lastError,
    });
  }

  return Object.freeze({ audio, play, pause, poll, restart, dispose, status });
}
