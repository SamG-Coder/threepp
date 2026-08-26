/**
 * The score, transport and authored visual analysis for Fire Pattern 233.
 *
 * ThreeBrowser's native HTMLAudioElement bridge plays committed local WAV
 * files and exposes their RIFF cue clock. Web Audio synthesis/analyser nodes
 * are intentionally only compatibility shims in the native host, so the
 * soundtrack and its visual channels are authored from this shared score.
 */

export const FIRE_PATTERN_SEED =
  "p4 + 11c9h 9fwhsa assa dasd sa u923t u3240-9t 0w3";

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, Number(value) || 0));
const fract = value => value - Math.floor(value);
const smoothstep = value => {
  const unit = clamp(value);
  return unit * unit * (3 - 2 * unit);
};

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(text))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const FIRE_PATTERN_HASH = fnv1a(FIRE_PATTERN_SEED);
const hashUint = (a = 0, b = 0, c = 0) => {
  let value = FIRE_PATTERN_HASH ^ Math.imul((a | 0) + 1, 0x9e3779b1);
  value ^= Math.imul((b | 0) + 17, 0x85ebca6b);
  value ^= Math.imul((c | 0) + 101, 0xc2b2ae35);
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return (value ^ value >>> 15) >>> 0;
};
const hash01 = (a, b, c) => hashUint(a, b, c) / 0x1_0000_0000;

export const FIRE_SCORE_TRACK = Object.freeze({
  title: "CIN/SIN — Pattern of Fire +233",
  artist: "ThreeBrowser procedural score",
  seed: FIRE_PATTERN_SEED,
  seedHash: `0x${FIRE_PATTERN_HASH.toString(16).padStart(8, "0")}`,
  bpm: 128,
  beatsPerBar: 4,
  bars: 96,
  sampleRate: 48_000,
  channels: 2,
  bitsPerSample: 16,
  durationSeconds: 180,
  cueCount: 233,
  defaultVolume: 0.44,
  throughComposed: true,
  loop: false,
  looping: false,
  source: new URL("../assets/cin-sin-fire-pattern-233.wav", import.meta.url).href,
});

const RAW_SECTIONS = [
  { id: "cipher-in-the-dark", firstBar: 0, finalBar: 8, cueCount: 12,
    energy: 0.18, bass: 0.12, air: 0.27, heat: 0.10, flame: 0.09, smoke: 0.18, turbulence: 0.12,
    rootMidi: 38, mode: "dorian", density: 0.18 },
  { id: "first-ignition", firstBar: 8, finalBar: 20, cueCount: 19,
    energy: 0.36, bass: 0.28, air: 0.42, heat: 0.31, flame: 0.34, smoke: 0.24, turbulence: 0.25,
    rootMidi: 43, mode: "phrygian", density: 0.32 },
  { id: "oxygen-spiral", firstBar: 20, finalBar: 32, cueCount: 24,
    energy: 0.58, bass: 0.48, air: 0.57, heat: 0.53, flame: 0.56, smoke: 0.31, turbulence: 0.44,
    rootMidi: 41, mode: "harmonic-minor", density: 0.48 },
  { id: "running-fire", firstBar: 32, finalBar: 44, cueCount: 28,
    energy: 0.78, bass: 0.71, air: 0.66, heat: 0.74, flame: 0.78, smoke: 0.42, turbulence: 0.62,
    rootMidi: 45, mode: "dorian-sharp-four", density: 0.67 },
  { id: "crownfire-rise", firstBar: 44, finalBar: 56, cueCount: 34,
    energy: 0.96, bass: 0.92, air: 0.81, heat: 0.98, flame: 1.00, smoke: 0.52, turbulence: 0.90,
    rootMidi: 40, mode: "phrygian-dominant", density: 0.88 },
  { id: "ash-eye", firstBar: 56, finalBar: 66, cueCount: 18,
    energy: 0.31, bass: 0.17, air: 0.24, heat: 0.29, flame: 0.24, smoke: 0.74, turbulence: 0.20,
    rootMidi: 36, mode: "minor", density: 0.25 },
  { id: "windborne-return", firstBar: 66, finalBar: 78, cueCount: 31,
    energy: 0.73, bass: 0.65, air: 0.66, heat: 0.70, flame: 0.76, smoke: 0.47, turbulence: 0.61,
    rootMidi: 46, mode: "lydian-minor", density: 0.72 },
  { id: "white-heat-cathedral", firstBar: 78, finalBar: 92, cueCount: 49,
    energy: 1.00, bass: 0.98, air: 0.94, heat: 1.00, flame: 1.00, smoke: 0.60, turbulence: 1.00,
    rootMidi: 43, mode: "octatonic", density: 1.00 },
  { id: "last-coal", firstBar: 92, finalBar: 96, cueCount: 18,
    energy: 0.22, bass: 0.13, air: 0.19, heat: 0.18, flame: 0.16, smoke: 0.56, turbulence: 0.10,
    rootMidi: 31, mode: "minor-add-nine", density: 0.22 },
];

const secondsPerBar = 60 * FIRE_SCORE_TRACK.beatsPerBar / FIRE_SCORE_TRACK.bpm;
const secondsPerSixteenth = secondsPerBar / 16;

export const FIRE_SCORE_SECTIONS = Object.freeze(RAW_SECTIONS.map((section, index) =>
  Object.freeze({
    ...section,
    index,
    startSeconds: section.firstBar * secondsPerBar,
    endSeconds: section.finalBar * secondsPerBar,
    durationSeconds: (section.finalBar - section.firstBar) * secondsPerBar,
  })
));

function makeFireCues() {
  const cues = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const goldenRatio = (1 + Math.sqrt(5)) * 0.5;
  let cueId = 1;

  for (const section of FIRE_SCORE_SECTIONS) {
    const firstSlot = section.firstBar * 16;
    const slotCount = (section.finalBar - section.firstBar) * 16;
    const candidates = [];
    for (let localSlot = 0; localSlot < slotCount; ++localSlot) {
      const globalSlot = firstSlot + localSlot;
      const sixteenth = globalSlot % 16;
      let score = hash01(section.index, globalSlot, 0x233);
      if (localSlot === 0) score += 4;
      else if (sixteenth === 0) score += 0.52;
      else if (sixteenth === 8) score += 0.24;
      else if (sixteenth === 6 || sixteenth === 14) score += 0.10;
      score += Math.sin((globalSlot + 4) * 0.61803398875) * 0.035;
      candidates.push({ globalSlot, localSlot, score });
    }
    const chosen = candidates
      .sort((left, right) => right.score - left.score || left.globalSlot - right.globalSlot)
      .slice(0, section.cueCount)
      .sort((left, right) => left.globalSlot - right.globalSlot);

    for (const candidate of chosen) {
      const sixteenth = candidate.globalSlot % 16;
      const localBar = Math.floor(candidate.localSlot / 16);
      const majorBoundary = candidate.localSlot === 0;
      const majorCrown = !majorBoundary && sixteenth === 0 &&
        ((localBar + section.index * 2) % (section.index >= 7 ? 3 : 4) === 0);
      const tier = majorBoundary || majorCrown ? 3 :
        (sixteenth === 0 || sixteenth === 8 || candidate.score > 1.02 ? 2 : 1);
      const kind = majorBoundary ? "ignition" :
        section.id === "ash-eye" ? (tier > 1 ? "ash-fall" : "ember") :
          section.id === "last-coal" ? (tier > 1 ? "coal-pulse" : "ember") :
            tier === 3 ? "crown" : tier === 2 ? "flare" : "spark";
      const jitter = hash01(cueId, section.index, 0x51);
      const strength = clamp(
        0.34 + section.energy * 0.38 + tier * 0.08 + jitter * 0.13,
        0,
        tier === 3 ? 1 : 0.94,
      );
      const angle = cueId * goldenAngle + hash01(section.index, 9, 3) * Math.PI * 2;
      const radialUnit = Math.sqrt(fract(cueId / goldenRatio + hash01(section.index, cueId, 4)));
      const timeSeconds = candidate.globalSlot * secondsPerSixteenth;
      cues.push(Object.freeze({
        cueId,
        section: section.id,
        sectionIndex: section.index,
        timeSeconds,
        sampleFrame: Math.round(timeSeconds * FIRE_SCORE_TRACK.sampleRate),
        bar: Math.floor(candidate.globalSlot / 16),
        beat: Math.floor(candidate.globalSlot / 4),
        sixteenth,
        kind,
        tier,
        strength,
        heat: clamp(section.heat * 0.70 + strength * 0.30),
        turbulence: clamp(section.turbulence * 0.72 + jitter * 0.28),
        x: Math.cos(angle) * radialUnit,
        z: Math.sin(angle) * radialUnit,
        radius: 0.16 + tier * 0.09 + strength * 0.08,
        hue: clamp(0.018 + (1 - strength) * 0.095 + section.index * 0.003, 0.012, 0.14),
      }));
      cueId += 1;
    }
  }

  if (cues.length !== FIRE_SCORE_TRACK.cueCount) {
    throw new Error(`Fire score cue count mismatch: ${cues.length}`);
  }
  return Object.freeze(cues);
}

export const FIRE_SCORE_CUES = makeFireCues();
const CUE_BY_ID = new Map(FIRE_SCORE_CUES.map(cue => [cue.cueId, cue]));

function sectionAtTime(timeSeconds) {
  const gridTime = Math.min(
    FIRE_SCORE_TRACK.durationSeconds - 1 / FIRE_SCORE_TRACK.sampleRate,
    Math.max(0, timeSeconds),
  );
  return FIRE_SCORE_SECTIONS.find(section => gridTime < section.endSeconds) ??
    FIRE_SCORE_SECTIONS.at(-1);
}

export function fireScorePositionAt(seconds = 0) {
  const requested = Number(seconds);
  const timeSeconds = Number.isFinite(requested)
    ? Math.max(0, Math.min(FIRE_SCORE_TRACK.durationSeconds, requested))
    : 0;
  const ended = timeSeconds >= FIRE_SCORE_TRACK.durationSeconds;
  const gridTime = ended
    ? FIRE_SCORE_TRACK.durationSeconds - 1 / FIRE_SCORE_TRACK.sampleRate
    : timeSeconds;
  const beatPosition = gridTime * FIRE_SCORE_TRACK.bpm / 60;
  const barPosition = beatPosition / FIRE_SCORE_TRACK.beatsPerBar;
  const sectionInfo = sectionAtTime(gridTime);
  const sectionProgress = clamp(
    (gridTime - sectionInfo.startSeconds) / sectionInfo.durationSeconds,
  );
  return Object.freeze({
    timeSeconds,
    ended,
    beatPosition,
    beat: Math.min(FIRE_SCORE_TRACK.bars * FIRE_SCORE_TRACK.beatsPerBar - 1, Math.floor(beatPosition)),
    beatPhase: fract(beatPosition),
    barPosition,
    bar: Math.min(FIRE_SCORE_TRACK.bars - 1, Math.floor(barPosition)),
    barPhase: fract(barPosition),
    section: sectionInfo.id,
    sectionIndex: sectionInfo.index,
    sectionInfo,
    sectionProgress,
  });
}

function latestCueIndexAt(timeSeconds) {
  let low = 0;
  let high = FIRE_SCORE_CUES.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (FIRE_SCORE_CUES[middle].timeSeconds <= timeSeconds) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/**
 * Deterministic visual channels authored from the same score as the WAV.
 * Values are normalized to [0, 1], require no microphone or FFT, and do not
 * wrap at 180 seconds.
 */
export function sampleFireScore(seconds = 0) {
  const position = fireScorePositionAt(seconds);
  const section = position.sectionInfo;
  const beatPulse = Math.exp(-position.beatPhase * (8.8 + section.density * 4.2));
  const eighthPhase = fract(position.beatPosition * 2);
  const sixteenthPhase = fract(position.beatPosition * 4);
  const offBeat = Math.exp(-Math.abs(position.beatPhase - 0.5) * 16);
  const emberTick = Math.exp(-sixteenthPhase * 18);
  let accent = 0;
  let spark = 0;
  let flare = 0;
  let crown = 0;
  let cueId = 0;

  for (let index = latestCueIndexAt(position.timeSeconds); index >= 0; --index) {
    const cue = FIRE_SCORE_CUES[index];
    const age = position.timeSeconds - cue.timeSeconds;
    if (age > 2.75) break;
    if (age < 0) continue;
    cueId ||= cue.cueId;
    const sharp = cue.strength * Math.exp(-age * (cue.tier === 3 ? 8 : cue.tier === 2 ? 13 : 24));
    accent = Math.max(accent, sharp);
    if (cue.tier === 3) crown += cue.strength * Math.exp(-age * 3.8);
    else if (cue.tier === 2) flare += cue.strength * Math.exp(-age * 6.2);
    else spark += cue.strength * Math.exp(-age * 18);
  }

  accent = clamp(accent);
  spark = clamp(spark);
  flare = clamp(flare);
  crown = clamp(crown);
  const arc = Math.sin(Math.PI * position.sectionProgress);
  const rising = smoothstep(position.sectionProgress);
  const outroFade = position.section === "last-coal"
    ? 1 - smoothstep(position.sectionProgress)
    : 1;
  const pulse = clamp((beatPulse * (0.28 + section.density * 0.64) + accent * 0.56) * outroFade);
  const bass = clamp(
    (section.bass * (0.66 + beatPulse * 0.28) + crown * 0.20 + flare * 0.09) * outroFade,
  );
  const mid = clamp(
    section.energy * (0.48 + offBeat * 0.18 + arc * 0.16) + flare * 0.20 + crown * 0.12,
  );
  const air = clamp(
    section.air * (0.62 + emberTick * section.density * 0.16) + spark * 0.38 + flare * 0.13,
  );
  const energy = clamp(
    section.energy * (0.72 + arc * 0.15 + pulse * 0.12) + crown * 0.18 + flare * 0.07,
  );
  const heat = clamp(section.heat * (0.72 + rising * 0.17) + bass * 0.09 + crown * 0.22);
  const flame = clamp(section.flame * (0.68 + pulse * 0.20 + arc * 0.10) + flare * 0.18 + crown * 0.22);
  const smoke = clamp(section.smoke * (0.78 + (1 - pulse) * 0.14) + crown * 0.08);
  const turbulence = clamp(
    section.turbulence * (0.68 + offBeat * 0.13 + emberTick * 0.08) + accent * 0.20,
  );

  return Object.freeze({
    ...position,
    pulse,
    bass,
    mid,
    air,
    energy,
    heat: position.ended ? 0 : heat,
    flame: position.ended ? 0 : flame,
    smoke,
    turbulence: position.ended ? 0 : turbulence,
    spark: position.ended ? 0 : spark,
    flare: position.ended ? 0 : flare,
    crown: position.ended ? 0 : crown,
    accent: position.ended ? 0 : accent,
    cueId,
    cueIndex: cueId,
    cuesPassed: cueId,
  });
}

function defaultAudioFactory(source) {
  const AudioConstructor = globalThis.Audio;
  return typeof AudioConstructor === "function" ? new AudioConstructor(source) : null;
}

/** Create a non-autoplaying, non-looping controller for the native WAV. */
export function createFireScoreAudioController({
  volume = FIRE_SCORE_TRACK.defaultVolume,
  audioFactory = defaultAudioFactory,
  source = FIRE_SCORE_TRACK.source,
} = {}) {
  let audio = null;
  let error = "";
  let disposed = false;
  let requestedPlay = false;
  let masterVolume = clamp(volume);
  const cueTolerance = 0.5 / FIRE_SCORE_TRACK.sampleRate;
  let fallbackCueCursor = -cueTolerance;

  try {
    audio = audioFactory(source) ?? null;
    if (audio) {
      audio.loop = false;
      audio.preload = "auto";
      audio.volume = masterVolume;
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
    audio = null;
  }

  const currentTime = () => clamp(
    Number(audio?.currentTime) || 0,
    0,
    FIRE_SCORE_TRACK.durationSeconds,
  );
  const isPlaying = () => Boolean(
    audio && requestedPlay && !audio.paused && !audio.ended && !disposed,
  );

  function snapshot() {
    const analysis = sampleFireScore(currentTime());
    return Object.freeze({
      ...analysis,
      available: Boolean(audio) && !disposed,
      playing: isPlaying(),
      volume: masterVolume,
      durationSeconds: FIRE_SCORE_TRACK.durationSeconds,
      error,
    });
  }

  async function start() {
    if (!audio || disposed) return false;
    if (audio.ended || currentTime() >= FIRE_SCORE_TRACK.durationSeconds) {
      try { audio.currentTime = 0; } catch { /* host may be shutting down */ }
      fallbackCueCursor = -cueTolerance;
    }
    requestedPlay = true;
    try {
      const result = audio.play?.();
      if (result && typeof result.then === "function") await result;
      error = "";
      return true;
    } catch (reason) {
      requestedPlay = false;
      error = reason instanceof Error ? reason.message : String(reason);
      return false;
    }
  }

  function pause() {
    requestedPlay = false;
    audio?.pause?.();
    return snapshot();
  }

  async function toggle() {
    return isPlaying() ? (pause(), false) : start();
  }

  function seek(seconds = 0) {
    const nextTime = clamp(seconds, 0, FIRE_SCORE_TRACK.durationSeconds);
    if (audio && !disposed) {
      try { audio.currentTime = nextTime; } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
    }
    fallbackCueCursor = nextTime;
    return snapshot();
  }

  async function restart() {
    pause();
    seek(0);
    fallbackCueCursor = -cueTolerance;
    return start();
  }

  function setVolume(nextVolume) {
    masterVolume = clamp(nextVolume);
    if (audio) audio.volume = masterVolume;
    return masterVolume;
  }

  function enrichCuePacket(packet) {
    const descriptor = CUE_BY_ID.get(Math.trunc(Number(packet?.cueId))) ?? null;
    return Object.freeze({
      ...(descriptor ?? {}),
      ...(packet ?? {}),
      cue: descriptor,
    });
  }

  function pollCues() {
    if (!audio || disposed || !isPlaying()) return Object.freeze([]);
    if (typeof audio.pollCues === "function") {
      try {
        const packets = audio.pollCues();
        return Object.freeze(
          (Array.isArray(packets) ? packets : []).map(enrichCuePacket),
        );
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
        return Object.freeze([]);
      }
    }

    const now = currentTime();
    if (now + cueTolerance < fallbackCueCursor) {
      fallbackCueCursor = now;
      return Object.freeze([]);
    }
    const crossed = FIRE_SCORE_CUES.filter(cue =>
      cue.timeSeconds > fallbackCueCursor && cue.timeSeconds <= now + cueTolerance
    ).map(cue => enrichCuePacket({
      cueId: cue.cueId,
      sampleFrame: cue.sampleFrame,
      absoluteSample: cue.sampleFrame,
      playheadSample: Math.round(now * FIRE_SCORE_TRACK.sampleRate),
      sampleRate: FIRE_SCORE_TRACK.sampleRate,
      loop: 0,
      loopIndex: 0,
    }));
    fallbackCueCursor = now;
    return Object.freeze(crossed);
  }

  function dispose() {
    if (disposed) return;
    pause();
    disposed = true;
    if (audio) {
      audio.removeAttribute?.("src");
      try { audio.src = ""; } catch { /* native bridge may expose readonly source */ }
      audio.load?.();
      audio.close?.();
    }
    audio = null;
  }

  return Object.freeze({
    start,
    toggle,
    pause,
    restart,
    seek,
    setVolume,
    pollCues,
    update: snapshot,
    status: snapshot,
    dispose,
  });
}
