const SAMPLE_RATE = 22_050;

function clampSample(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0));
}
export function synthesizeWav(duration, sampleAt, sampleRate = SAMPLE_RATE) {
  const frames = Math.max(1, Math.round(Math.max(0.01, Number(duration) || 0.01) * sampleRate));
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => {
    for (let index = 0; index < value.length; ++index) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < frames; ++frame) {
    const time = frame / sampleRate;
    const value = clampSample(sampleAt(time, frame, frames));
    view.setInt16(44 + frame * 2, Math.round(value * 32767), true);
  }
  return bytes;
}

function deterministicNoise(seed = 0x4e454f4e) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x80000000 - 1;
  };
}

export function createAudioDefinitions() {
  const tau = Math.PI * 2;
  return {
    ambience: synthesizeWav(8, time => {
      const pulse = Math.sin(tau * 0.5 * time) > 0 ? 1 : 0.42;
      const bass = Math.sin(tau * 55 * time) * 0.12 * pulse;
      const pad = Math.sin(tau * 110 * time) * 0.035 + Math.sin(tau * 165 * time) * 0.025;
      const shimmer = Math.sin(tau * 440 * time) * (0.012 + 0.008 * Math.sin(tau * 0.25 * time));
      return bass + pad + shimmer;
    }),
    cityDay: (() => {
      const noise = deterministicNoise(0x44415943);
      let trafficBed = 0;
      return synthesizeWav(8, time => {
        const sample = noise();
        trafficBed += (sample - trafficBed) * 0.018;
        let birds = 0;
        for (const start of [0.75, 2.92, 5.36, 6.08]) {
          const local = time - start;
          if (local < 0 || local > 0.24) continue;
          const envelope = Math.sin(Math.PI * local / 0.24) ** 1.7;
          const frequency = 1720 + local * 1850 + Math.sin(local * 64) * 210;
          birds += Math.sin(tau * frequency * local) * envelope * 0.16;
        }
        const distantMotor = Math.sin(tau * 47 * time + Math.sin(tau * 0.17 * time) * 1.4) * 0.025;
        return trafficBed * 0.26 + sample * 0.008 + distantMotor + birds;
      });
    })(),
    cityNight: (() => {
      const noise = deterministicNoise(0x4e495445);
      let hum = 0;
      return synthesizeWav(8, time => {
        const sample = noise();
        hum += (sample - hum) * 0.012;
        const insectGate = Math.max(0, Math.sin(tau * 3.7 * time)) ** 9;
        const secondGate = Math.max(0, Math.sin(tau * 4.15 * time + 1.7)) ** 11;
        const insects = Math.sin(tau * 3460 * time) * insectGate * 0.035 +
          Math.sin(tau * 3890 * time) * secondGate * 0.025;
        const distantCity = Math.sin(tau * 58 * time) * 0.018 + Math.sin(tau * 116 * time) * 0.008;
        return hum * 0.22 + distantCity + insects;
      });
    })(),
    engine: synthesizeWav(2, time => {
      const fundamental = Math.sin(tau * 46 * time);
      const second = Math.sin(tau * 92 * time + 0.2);
      const third = Math.sin(tau * 138 * time + 0.5);
      return fundamental * 0.23 + second * 0.13 + third * 0.06;
    }),
    siren: synthesizeWav(2, time => {
      const blend = (Math.sin(tau * 0.5 * time) + 1) * 0.5;
      const frequency = 620 + blend * 260;
      return Math.sin(tau * frequency * time) * 0.28 + Math.sin(tau * frequency * 0.5 * time) * 0.08;
    }),
    gunshot: (() => {
      const noise = deterministicNoise(0x47554e);
      return synthesizeWav(0.24, time => {
        const envelope = Math.exp(-time * 22);
        return noise() * envelope * 0.78 + Math.sin(tau * 92 * time) * Math.exp(-time * 18) * 0.26;
      });
    })(),
    impact: (() => {
      const noise = deterministicNoise(0x494d5041);
      return synthesizeWav(0.28, time => noise() * Math.exp(-time * 14) * 0.55 + Math.sin(tau * 68 * time) * Math.exp(-time * 10) * 0.4);
    })(),
    melee: (() => {
      const noise = deterministicNoise(0x4d454c45);
      return synthesizeWav(0.34, time => {
        const sweep = Math.sin(tau * (170 - time * 280) * time) * Math.exp(-time * 12) * 0.24;
        return noise() * Math.sin(Math.min(Math.PI, time * 14)) * Math.exp(-time * 9) * 0.32 + sweep;
      });
    })(),
    pickup: synthesizeWav(0.42, time => {
      const frequency = time < 0.14 ? 523.25 : time < 0.28 ? 659.25 : 783.99;
      return Math.sin(tau * frequency * time) * Math.exp(-time * 2.7) * 0.38;
    }),
    mission: synthesizeWav(0.9, time => {
      const notes = [261.63, 329.63, 392, 523.25];
      const note = notes[Math.min(notes.length - 1, Math.floor(time / 0.2))];
      const local = time % 0.2;
      return Math.sin(tau * note * time) * Math.exp(-local * 4) * 0.34;
    }),
    horn: synthesizeWav(0.55, time => (Math.sin(tau * 220 * time) * 0.28 + Math.sin(tau * 277 * time) * 0.2) * Math.min(1, time * 25) * Math.exp(-time * 1.2)),
    rain: (() => {
      const noise = deterministicNoise(0x5241494e);
      let low = 0;
      return synthesizeWav(6, () => {
        const sample = noise();
        low += (sample - low) * 0.18;
        return sample * 0.13 + low * 0.24;
      });
    })(),
    thunder: (() => {
      const noise = deterministicNoise(0x5448554e);
      let low = 0;
      let rumble = 0;
      return synthesizeWav(2.7, time => {
        const sample = noise();
        low += (sample - low) * 0.035;
        rumble += (low - rumble) * 0.055;
        const attack = Math.min(1, time * 24);
        const envelope = attack * Math.exp(-time * 1.08);
        const body = Math.sin(tau * 38 * time + Math.sin(tau * 2.2 * time) * 0.7) * 0.24;
        const crack = sample * Math.exp(-time * 13) * 0.26;
        return (rumble * 1.25 + body) * envelope + crack;
      });
    })(),
    tire: (() => {
      const noise = deterministicNoise(0x54495245);
      return synthesizeWav(2, time => noise() * 0.24 + Math.sin(tau * 34 * time) * 0.08);
    })(),
    footstep: (() => {
      const noise = deterministicNoise(0x464f4f54);
      return synthesizeWav(0.22, time => {
        const envelope = Math.exp(-time * 24);
        return noise() * envelope * 0.28 + Math.sin(tau * 72 * time) * envelope * 0.32;
      });
    })(),
    reload: synthesizeWav(0.54, time => {
      const clicks = [0.02, 0.21, 0.43].reduce((sum, moment, index) => {
        const local = time - moment;
        return sum + (local >= 0 ? Math.sin(tau * (760 + index * 210) * local) * Math.exp(-local * 62) : 0);
      }, 0);
      return clicks * 0.42;
    }),
    empty: synthesizeWav(0.12, time => Math.sin(tau * 1100 * time) * Math.exp(-time * 58) * 0.28),
    hurt: (() => {
      const noise = deterministicNoise(0x48555254);
      return synthesizeWav(0.36, time => (noise() * 0.22 + Math.sin(tau * 86 * time) * 0.32) * Math.exp(-time * 11));
    })(),
    radio: (() => {
      const noise = deterministicNoise(0x52414449);
      return synthesizeWav(0.85, time => {
        const carrier = Math.sin(tau * 930 * time) * Math.sin(tau * 23 * time);
        return (noise() * 0.12 + carrier * 0.16) * Math.min(1, time * 18) * Math.exp(-time * 1.4);
      });
    })(),
    taxiDoor: (() => {
      const noise = deterministicNoise(0x444f4f52);
      return synthesizeWav(0.42, time => {
        const latch = Math.sin(tau * 185 * time) * Math.exp(-time * 34) * 0.24;
        const body = Math.sin(tau * 54 * time) * Math.exp(-time * 11) * 0.34;
        const tail = noise() * Math.exp(-time * 18) * 0.16;
        return latch + body + tail;
      });
    })(),
    seatbelt: synthesizeWav(0.34, time => {
      const click = moment => {
        const local = time - moment;
        return local >= 0
          ? (Math.sin(tau * 1_420 * local) * 0.24 + Math.sin(tau * 710 * local) * 0.13) * Math.exp(-local * 72)
          : 0;
      };
      return click(0.035) + click(0.19);
    }),
    taxiMeter: synthesizeWav(0.30, time => {
      const tick = moment => {
        const local = time - moment;
        return local >= 0
          ? Math.sin(tau * 1_060 * local) * Math.exp(-local * 68) * 0.24
          : 0;
      };
      return tick(0.03) + tick(0.145);
    }),
  };
}

async function ensureAudioFiles() {
  const [{ access, mkdir, writeFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const local = globalThis.process?.env?.LOCALAPPDATA || globalThis.process?.env?.TEMP || globalThis.process?.cwd?.() || ".";
  const directory = path.join(local, "ThreeBrowser", "GtaNeonCity", "audio-v2");
  await mkdir(directory, { recursive: true });
  const files = {};
  for (const [name, bytes] of Object.entries(createAudioDefinitions())) {
    const file = path.join(directory, `${name}.wav`);
    try { await access(file); } catch { await writeFile(file, bytes); }
    files[name] = file;
  }
  return files;
}

export async function createGameAudio() {
  if (typeof globalThis.Audio !== "function") throw new Error("Native Audio is unavailable");
  const files = await ensureAudioFiles();
  const elements = {};
  const oneShots = new Set([
    "gunshot", "impact", "melee", "pickup", "mission", "horn", "footstep", "reload", "empty", "hurt",
    "radio", "thunder", "taxiDoor", "seatbelt", "taxiMeter",
  ]);
  for (const [name, file] of Object.entries(files)) {
    const element = new globalThis.Audio(file);
    element.preload = "auto";
    element.loop = ["ambience", "cityDay", "cityNight", "engine", "siren", "rain", "tire"].includes(name);
    element.volume = name === "ambience" ? 0.13 : 0;
    elements[name] = element;
  }
  let started = false;
  let disposed = false;
  const warned = new Set();

  function safePlay(name) {
    const element = elements[name];
    if (!element || disposed) return;
    void element.play().catch(error => {
      if (warned.has(name)) return;
      warned.add(name);
      console.warn(`[GTA Neon City] ${name} audio unavailable: ${error?.message || error}`);
    });
  }

  function start() {
    if (started || disposed) return;
    started = true;
    safePlay("ambience");
    safePlay("cityDay");
    safePlay("cityNight");
    safePlay("engine");
    safePlay("siren");
    safePlay("rain");
    safePlay("tire");
  }

  function play(name, volume = 0.65) {
    const element = elements[name];
    if (!element || !oneShots.has(name) || disposed) return;
    element.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    element.currentTime = 0;
    safePlay(name);
  }

  function update({ driving = false, speed = 0, wantedStars = 0, rain = 0, tireSlip = 0, timeHours = 12 } = {}) {
    start();
    const engine = elements.engine;
    const siren = elements.siren;
    const rainfall = elements.rain;
    const tire = elements.tire;
    const dayBed = elements.cityDay;
    const nightBed = elements.cityNight;
    const normalizedSpeed = Math.min(1, Math.abs(Number(speed) || 0) / 30);
    const wetness = Math.min(1, Math.max(0, Number(rain) || 0));
    const hour = ((Number(timeHours) || 0) % 24 + 24) % 24;
    const solar = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const night = 1 - Math.min(1, solar * 1.7);
    const outsideMix = (driving ? 0.48 : 1) * (1 - wetness * 0.52);
    engine.volume = driving ? 0.12 + normalizedSpeed * 0.22 : 0;
    engine.playbackRate = 0.72 + normalizedSpeed * 1.18;
    siren.volume = wantedStars > 0 ? Math.min(0.34, 0.12 + wantedStars * 0.045) : 0;
    rainfall.volume = Math.min(0.28, wetness * 0.25);
    tire.volume = driving ? Math.min(0.24, Math.max(0, Number(tireSlip) || 0) * 0.22) : 0;
    tire.playbackRate = 0.82 + normalizedSpeed * 0.72;
    dayBed.volume = (0.018 + solar * 0.105) * outsideMix;
    nightBed.volume = (0.012 + night * 0.082) * outsideMix;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const element of Object.values(elements)) element.close?.();
  }

  return { files, elements, start, play, update, dispose };
}
