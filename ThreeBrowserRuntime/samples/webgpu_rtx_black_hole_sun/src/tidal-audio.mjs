const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, Number(value) || 0));

export const TIDAL_SCORE = Object.freeze({
  title: "Spacetime in Tension",
  artist: "ThreeBrowser procedural sonification",
  durationSeconds: 72,
  sampleRate: 48_000,
  channels: 2,
  defaultVolume: 0.48,
  source: new URL("../assets/tidal-rupture-score.wav", import.meta.url).href,
});

function defaultAudioFactory(source) {
  const AudioConstructor = globalThis.Audio;
  return typeof AudioConstructor === "function" ? new AudioConstructor(source) : null;
}

export function createTidalAudioController({
  source = TIDAL_SCORE.source,
  volume = TIDAL_SCORE.defaultVolume,
  audioFactory = defaultAudioFactory,
} = {}) {
  let audio = null;
  let disposed = false;
  let requestedPlay = false;
  let error = "";
  let masterVolume = clamp(volume);
  let playbackRate = 1;

  try {
    audio = audioFactory(source) ?? null;
    if (audio) {
      audio.loop = false;
      audio.preload = "auto";
      audio.volume = masterVolume;
      audio.playbackRate = playbackRate;
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
    audio = null;
  }

  const currentTime = () => clamp(
    Number(audio?.currentTime) || 0,
    0,
    TIDAL_SCORE.durationSeconds,
  );
  const isPlaying = () => Boolean(
    audio && requestedPlay && !audio.paused && !audio.ended && !disposed,
  );

  function snapshot() {
    const timeSeconds = currentTime();
    return Object.freeze({
      available: Boolean(audio) && !disposed,
      playing: isPlaying(),
      ended: Boolean(audio?.ended) || timeSeconds >= TIDAL_SCORE.durationSeconds - 0.002,
      timeSeconds,
      durationSeconds: TIDAL_SCORE.durationSeconds,
      playbackRate,
      volume: masterVolume,
      error,
    });
  }

  function seek(seconds = 0) {
    const target = clamp(seconds, 0, TIDAL_SCORE.durationSeconds);
    if (audio && !disposed) {
      try { audio.currentTime = target; } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
    }
    return snapshot();
  }

  function setPlaybackRate(rate = 1) {
    playbackRate = clamp(rate, 0.5, 2);
    if (audio) audio.playbackRate = playbackRate;
    return playbackRate;
  }

  function setVolume(nextVolume = TIDAL_SCORE.defaultVolume) {
    masterVolume = clamp(nextVolume);
    if (audio) audio.volume = masterVolume;
    return masterVolume;
  }

  async function start({ timeSeconds = currentTime(), rate = playbackRate } = {}) {
    if (!audio || disposed) return false;
    setPlaybackRate(rate);
    let target = clamp(timeSeconds, 0, TIDAL_SCORE.durationSeconds);
    if (audio.ended || target >= TIDAL_SCORE.durationSeconds - 0.002) target = 0;
    if (Math.abs(currentTime() - target) > 0.08) seek(target);
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

  async function toggle(options = {}) {
    if (isPlaying()) {
      pause();
      return false;
    }
    return start(options);
  }

  async function restart({ rate = playbackRate } = {}) {
    pause();
    seek(0);
    return start({ timeSeconds: 0, rate });
  }

  function arm() {
    audio?.load?.();
    return Boolean(audio) && !disposed;
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
    arm,
    start,
    toggle,
    pause,
    restart,
    seek,
    setPlaybackRate,
    setVolume,
    update: snapshot,
    status: snapshot,
    dispose,
  });
}
