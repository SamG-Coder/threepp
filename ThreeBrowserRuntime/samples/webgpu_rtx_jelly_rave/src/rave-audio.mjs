/**
 * Original procedural soundtrack metadata and playback controller for the
 * jelly-rave sample. The visual analysis is authored from the same musical
 * grid as the generated WAV, so it remains deterministic on the native audio
 * bridge as well as in a browser without requiring microphone/FFT access.
 */

export const JELLY_RAVE_TRACK = Object.freeze({
  title: "Neon Jelly Pressure",
  artist: "ThreeBrowser procedural audio",
  bpm: 128,
  beatsPerBar: 4,
  bars: 24,
  sampleRate: 48_000,
  channels: 2,
  durationSeconds: 45,
  defaultVolume: 0.38,
  source: new URL("../assets/neon-jelly-rave.wav", import.meta.url).href,
});

export const JELLY_RAVE_SECTIONS = Object.freeze([
  Object.freeze({ id: "neon-ignition", firstBar: 0, finalBar: 4, energy: 0.68, drop: 0.08 }),
  Object.freeze({ id: "laser-lift", firstBar: 4, finalBar: 8, energy: 0.86, drop: 0.34 }),
  Object.freeze({ id: "prismatic-drop", firstBar: 8, finalBar: 16, energy: 1.0, drop: 1.0 }),
  Object.freeze({ id: "liquid-breakdown", firstBar: 16, finalBar: 20, energy: 0.54, drop: 0.16 }),
  Object.freeze({ id: "hyper-jelly-finale", firstBar: 20, finalBar: 24, energy: 1.0, drop: 1.0 }),
]);

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const fract = value => value - Math.floor(value);
const smoothstep = value => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export function raveSectionAt(seconds = 0) {
  const wrappedSeconds = ((Number(seconds) || 0) % JELLY_RAVE_TRACK.durationSeconds +
    JELLY_RAVE_TRACK.durationSeconds) % JELLY_RAVE_TRACK.durationSeconds;
  const bar = wrappedSeconds * JELLY_RAVE_TRACK.bpm /
    (60 * JELLY_RAVE_TRACK.beatsPerBar);
  return JELLY_RAVE_SECTIONS.find(section =>
    bar >= section.firstBar && bar < section.finalBar
  ) ?? JELLY_RAVE_SECTIONS[0];
}

/**
 * Return music-reactive values for one playhead position. `pulse` is the
 * main four-on-the-floor transient, while `bass` also includes the rolling
 * eighth-note bass pattern. All values are normalized to [0, 1].
 */
export function sampleRaveAnalysis(seconds = 0) {
  const duration = JELLY_RAVE_TRACK.durationSeconds;
  const timeSeconds = ((Number(seconds) || 0) % duration + duration) % duration;
  const beatPosition = timeSeconds * JELLY_RAVE_TRACK.bpm / 60;
  const beat = Math.floor(beatPosition) % (JELLY_RAVE_TRACK.bars * 4);
  const beatPhase = fract(beatPosition);
  const eighthPhase = fract(beatPosition * 2);
  const bar = Math.floor(beatPosition / JELLY_RAVE_TRACK.beatsPerBar);
  const barPhase = fract(beatPosition / JELLY_RAVE_TRACK.beatsPerBar);
  const section = raveSectionAt(timeSeconds);
  const sectionProgress = clamp(
    (bar + barPhase - section.firstBar) / (section.finalBar - section.firstBar),
  );

  const pulse = Math.exp(-beatPhase * 10.5);
  const subPulse = Math.exp(-eighthPhase * 7.2);
  const offBeat = Math.exp(-Math.abs(beatPhase - 0.5) * 15);
  const build = section.id === "laser-lift" ? smoothstep(sectionProgress) :
    section.id === "liquid-breakdown" ? 0.26 + 0.34 * smoothstep(sectionProgress) : 0;
  const finaleStrobe = section.id === "hyper-jelly-finale" ?
    Math.exp(-fract(beatPosition * 4) * 11) : 0;
  const bass = clamp((pulse * 0.76 + subPulse * 0.47) * (0.66 + section.drop * 0.34));
  const energy = clamp(
    section.energy * (0.78 + pulse * 0.13 + offBeat * 0.05) + build * 0.14 + finaleStrobe * 0.08,
  );

  return Object.freeze({
    timeSeconds,
    beat,
    beatPhase,
    bar,
    barPhase,
    section: section.id,
    sectionProgress,
    pulse: clamp(pulse),
    bass,
    energy,
    drop: section.drop,
    strobe: clamp(finaleStrobe),
  });
}

function defaultAudioFactory(source) {
  const AudioConstructor = globalThis.Audio;
  return typeof AudioConstructor === "function" ? new AudioConstructor(source) : null;
}

/**
 * Create an autoplay-safe music controller. Construction only prepares an
 * audio element; callers invoke start/toggle from a click or key event.
 */
export function createRaveAudioController({
  volume = JELLY_RAVE_TRACK.defaultVolume,
  audioFactory = defaultAudioFactory,
} = {}) {
  let audio = null;
  let error = "";
  let disposed = false;
  let requestedPlay = false;
  let masterVolume = clamp(Number(volume) || 0);

  try {
    audio = audioFactory(JELLY_RAVE_TRACK.source) ?? null;
    if (audio) {
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = masterVolume;
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
    audio = null;
  }

  function isPlaying() {
    return Boolean(audio && requestedPlay && !audio.paused && !audio.ended);
  }

  function snapshot() {
    const timeSeconds = Number(audio?.currentTime) || 0;
    return Object.freeze({
      ...sampleRaveAnalysis(timeSeconds),
      available: Boolean(audio) && !disposed,
      playing: isPlaying(),
      volume: masterVolume,
      error,
    });
  }

  async function start() {
    if (!audio || disposed) return false;
    requestedPlay = true;
    try {
      const result = audio.play?.();
      if (result && typeof result.then === "function") await result;
      error = "";
      return true;
    } catch (reason) {
      // Browser autoplay denial is expected until start() is called from a
      // genuine user gesture; retaining the element makes a retry harmless.
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

  function setVolume(nextVolume) {
    masterVolume = clamp(Number(nextVolume) || 0);
    if (audio) audio.volume = masterVolume;
    return masterVolume;
  }

  function dispose() {
    if (disposed) return;
    pause();
    disposed = true;
    if (audio) {
      audio.removeAttribute?.("src");
      try { audio.src = ""; } catch { /* native bridge may expose a readonly source */ }
      audio.load?.();
      audio.close?.();
    }
    audio = null;
  }

  return Object.freeze({
    start,
    toggle,
    pause,
    setVolume,
    update: snapshot,
    status: snapshot,
    dispose,
  });
}
