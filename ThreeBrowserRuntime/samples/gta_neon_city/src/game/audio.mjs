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

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length; ++index) value += String.fromCharCode(bytes[offset + index] ?? 0);
  return value;
}

/**
 * Expands one of the game's deterministic 16-bit mono WAVs into a stereo WAV
 * whose samples exist in exactly one channel. Two native Audio elements can
 * therefore provide true arbitrary stereo pan without relying on the runtime's
 * intentionally silent Web Audio compatibility shim.
 */
export function createChannelIsolatedStereoWav(monoBytes, channel = "left") {
  if (!(monoBytes instanceof Uint8Array) || monoBytes.byteLength < 44 ||
      ascii(monoBytes, 0, 4) !== "RIFF" || ascii(monoBytes, 8, 4) !== "WAVE") {
    throw new TypeError("createChannelIsolatedStereoWav requires a PCM WAV byte array");
  }
  const input = new DataView(monoBytes.buffer, monoBytes.byteOffset, monoBytes.byteLength);
  let formatOffset = -1;
  let formatSize = 0;
  let dataOffset = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= monoBytes.byteLength;) {
    const id = ascii(monoBytes, offset, 4);
    const size = input.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + size > monoBytes.byteLength) break;
    if (id === "fmt ") {
      formatOffset = payload;
      formatSize = size;
    } else if (id === "data") {
      dataOffset = payload;
      dataSize = size;
      break;
    }
    offset = payload + size + (size & 1);
  }
  if (formatOffset < 0 || formatSize < 16 || dataOffset < 0 ||
      input.getUint16(formatOffset, true) !== 1 ||
      input.getUint16(formatOffset + 2, true) !== 1 ||
      input.getUint16(formatOffset + 14, true) !== 16) {
    throw new TypeError("Spatial audio requires 16-bit mono PCM WAV input");
  }
  const leftOnly = String(channel).toLowerCase() !== "right";
  const sampleRate = input.getUint32(formatOffset + 4, true);
  const frames = Math.floor(dataSize / 2);
  const output = new Uint8Array(44 + frames * 4);
  const view = new DataView(output.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; ++index) output[offset + index] = value.charCodeAt(index);
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, frames * 4, true);
  for (let frame = 0; frame < frames; ++frame) {
    const sample = input.getInt16(dataOffset + frame * 2, true);
    view.setInt16(44 + frame * 4, leftOnly ? sample : 0, true);
    view.setInt16(46 + frame * 4, leftOnly ? 0 : sample, true);
  }
  return output;
}

export const SPATIAL_AUDIO_PROFILES = Object.freeze({
  gunshot: Object.freeze({ referenceDistance: 5, maxDistance: 180, rolloff: 1.0 }),
  impact: Object.freeze({ referenceDistance: 3, maxDistance: 85, rolloff: 1.25 }),
  horn: Object.freeze({ referenceDistance: 8, maxDistance: 160, rolloff: 0.82 }),
  footstep: Object.freeze({ referenceDistance: 1.4, maxDistance: 30, rolloff: 1.2 }),
  melee: Object.freeze({ referenceDistance: 1.5, maxDistance: 28, rolloff: 1.25 }),
  thunder: Object.freeze({ referenceDistance: 28, maxDistance: 520, rolloff: 0.32 }),
  siren: Object.freeze({ referenceDistance: 12, maxDistance: 240, rolloff: 0.72 }),
});

export const SPATIAL_VOICE_COUNTS = Object.freeze({
  gunshot: 6,
  impact: 6,
  horn: 3,
  footstep: 4,
  melee: 3,
  thunder: 1,
});

function finiteComponent(value, key, index, fallback = 0) {
  const component = Array.isArray(value) || ArrayBuffer.isView(value) ? value[index] : value?.[key];
  const number = Number(component);
  return Number.isFinite(number) ? number : fallback;
}

export function createSpatialListenerState() {
  return {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    revision: 0,
  };
}

export function updateSpatialListener(listener, position, forward, up) {
  if (!listener?.position || !listener?.forward || !listener?.up || !listener?.right) {
    throw new TypeError("updateSpatialListener requires a reusable listener state");
  }
  listener.position.x = finiteComponent(position, "x", 0);
  listener.position.y = finiteComponent(position, "y", 1);
  listener.position.z = finiteComponent(position, "z", 2);

  let fx = finiteComponent(forward, "x", 0, 0);
  let fy = finiteComponent(forward, "y", 1, 0);
  let fz = finiteComponent(forward, "z", 2, -1);
  let length = Math.hypot(fx, fy, fz);
  if (length < 1e-6) { fx = 0; fy = 0; fz = -1; length = 1; }
  fx /= length; fy /= length; fz /= length;

  let ux = finiteComponent(up, "x", 0, 0);
  let uy = finiteComponent(up, "y", 1, 1);
  let uz = finiteComponent(up, "z", 2, 0);
  length = Math.hypot(ux, uy, uz);
  if (length < 1e-6) { ux = 0; uy = 1; uz = 0; length = 1; }
  ux /= length; uy /= length; uz /= length;

  let rx = fy * uz - fz * uy;
  let ry = fz * ux - fx * uz;
  let rz = fx * uy - fy * ux;
  length = Math.hypot(rx, ry, rz);
  if (length < 1e-6) {
    rx = Math.abs(fy) > 0.95 ? 1 : -fz;
    ry = 0;
    rz = Math.abs(fy) > 0.95 ? 0 : fx;
    length = Math.hypot(rx, ry, rz) || 1;
  }
  rx /= length; ry /= length; rz /= length;
  // Re-orthogonalise up so camera roll is represented without introducing a
  // gain bias when a caller supplies an imperfect forward/up pair.
  ux = ry * fz - rz * fy;
  uy = rz * fx - rx * fz;
  uz = rx * fy - ry * fx;
  listener.forward.x = fx; listener.forward.y = fy; listener.forward.z = fz;
  listener.right.x = rx; listener.right.y = ry; listener.right.z = rz;
  listener.up.x = ux; listener.up.y = uy; listener.up.z = uz;
  listener.revision += 1;
  return listener;
}

/** Writes a native-stereo mix into `out`; callers can reuse one object forever. */
export function calculateSpatialMix(listener, worldPosition, profile = SPATIAL_AUDIO_PROFILES.impact, volume = 1, out = {}) {
  const sourceX = finiteComponent(worldPosition, "x", 0);
  const sourceY = finiteComponent(worldPosition, "y", 1);
  const sourceZ = finiteComponent(worldPosition, "z", 2);
  const dx = sourceX - listener.position.x;
  const dy = sourceY - listener.position.y;
  const dz = sourceZ - listener.position.z;
  const distance = Math.hypot(dx, dy, dz);
  const referenceDistance = Math.max(0.01, Number(profile?.referenceDistance) || 1);
  const maxDistance = Math.max(referenceDistance, Number(profile?.maxDistance) || referenceDistance);
  const rolloff = Math.max(0, Number(profile?.rolloff) || 0);
  const level = Math.max(0, Math.min(1, Number(volume) || 0));
  let attenuation = 0;
  if (distance < maxDistance && level > 0) {
    attenuation = distance <= referenceDistance
      ? 1
      : referenceDistance / (referenceDistance + rolloff * (distance - referenceDistance));
  }
  let pan = 0;
  if (distance > 1e-6) {
    pan = Math.max(-1, Math.min(1,
      (dx * listener.right.x + dy * listener.right.y + dz * listener.right.z) / distance));
  }
  const equalPowerAngle = (pan + 1) * Math.PI * 0.25;
  const gain = level * attenuation;
  out.sourceX = sourceX;
  out.sourceY = sourceY;
  out.sourceZ = sourceZ;
  out.distance = distance;
  out.pan = pan;
  out.attenuation = attenuation;
  out.leftGain = Math.cos(equalPowerAngle) * gain;
  out.rightGain = Math.sin(equalPowerAngle) * gain;
  out.accepted = gain > 0;
  return out;
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

export function createSpatialVoicePool({ name, count, leftFile, rightFile, createElement, playElement }) {
  const size = Math.max(1, Math.trunc(Number(count) || 1));
  if (typeof createElement !== "function" || typeof playElement !== "function") {
    throw new TypeError("createSpatialVoicePool requires fixed element creation and playback adapters");
  }
  const voices = new Array(size);
  for (let index = 0; index < size; ++index) {
    voices[index] = {
      left: createElement(leftFile, false, 0, `${name}:left:${index}`),
      right: createElement(rightFile, false, 0, `${name}:right:${index}`),
      sequence: 0,
    };
  }
  const api = {
    name,
    size,
    voices,
    cursor: 0,
    plays: 0,
    steals: 0,
    lastVoiceIndex: -1,
    lastStolen: false,
    trigger(mix) {
      if (!mix?.accepted) {
        api.lastVoiceIndex = -1;
        api.lastStolen = false;
        return -1;
      }
      const index = api.cursor;
      const voice = voices[index];
      api.cursor = (index + 1) % size;
      const stolen = voice.left.paused === false || voice.right.paused === false;
      voice.left.pause?.();
      voice.right.pause?.();
      voice.left.volume = Math.max(0, Math.min(1, Number(mix.leftGain) || 0));
      voice.right.volume = Math.max(0, Math.min(1, Number(mix.rightGain) || 0));
      voice.left.currentTime = 0;
      voice.right.currentTime = 0;
      playElement(voice.left, `${name}:left`);
      playElement(voice.right, `${name}:right`);
      voice.sequence += 1;
      api.plays += 1;
      api.steals += Number(stolen);
      api.lastVoiceIndex = index;
      api.lastStolen = stolen;
      return index;
    },
  };
  return api;
}

async function ensureAudioFiles() {
  const [{ access, mkdir, writeFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const local = globalThis.process?.env?.LOCALAPPDATA || globalThis.process?.env?.TEMP || globalThis.process?.cwd?.() || ".";
  const directory = path.join(local, "ThreeBrowser", "GtaNeonCity", "audio-v2");
  await mkdir(directory, { recursive: true });
  const definitions = createAudioDefinitions();
  const files = {};
  const writeOnce = async (file, bytes) => {
    try { await access(file); } catch { await writeFile(file, bytes); }
  };
  for (const [name, bytes] of Object.entries(definitions)) {
    const file = path.join(directory, `${name}.wav`);
    await writeOnce(file, bytes);
    files[name] = file;
  }
  const spatialFiles = {};
  for (const name of Object.keys(SPATIAL_AUDIO_PROFILES)) {
    const mono = definitions[name];
    if (!mono) throw new Error(`Missing procedural source for spatial sound: ${name}`);
    const left = path.join(directory, `${name}.spatial-v1-left.wav`);
    const right = path.join(directory, `${name}.spatial-v1-right.wav`);
    await Promise.all([
      writeOnce(left, createChannelIsolatedStereoWav(mono, "left")),
      writeOnce(right, createChannelIsolatedStereoWav(mono, "right")),
    ]);
    spatialFiles[name] = Object.freeze({ left, right });
  }
  return { files, spatialFiles };
}

function waitForAudioReady(element) {
  if (Number(element?.readyState) >= 3 || typeof element?.addEventListener !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener?.("canplaythrough", ready);
      element.removeEventListener?.("error", failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(`Native audio preload failed: ${element.currentSrc || element.src || "unknown"}`)); };
    element.addEventListener("canplaythrough", ready);
    element.addEventListener("error", failed);
  });
}

export async function createGameAudio(options = {}) {
  const audioFactory = typeof options.audioFactory === "function"
    ? options.audioFactory
    : typeof globalThis.Audio === "function"
      ? source => new globalThis.Audio(source)
      : null;
  if (!audioFactory) throw new Error("Native Audio is unavailable");
  const prepared = options.preparedFiles ?? await ensureAudioFiles();
  const files = prepared.files ?? prepared;
  const spatialFiles = prepared.spatialFiles ?? {};
  const elements = {};
  const oneShots = new Set([
    "gunshot", "impact", "melee", "pickup", "mission", "horn", "footstep", "reload", "empty", "hurt",
    "radio", "thunder", "taxiDoor", "seatbelt", "taxiMeter",
  ]);
  const loopNames = new Set(["ambience", "cityDay", "cityNight", "engine", "siren", "rain", "tire"]);
  const allElements = [];
  const readyPromises = [];
  const warned = new Set();
  let elementAllocations = 0;
  let sourceLoads = 0;
  let started = false;
  let disposed = false;
  let filesReady = false;

  function safePlayElement(element, label) {
    if (!element || disposed) return;
    try {
      const result = element.play?.();
      result?.catch?.(error => {
        if (warned.has(label)) return;
        warned.add(label);
        console.warn(`[GTA Neon City] ${label} audio unavailable: ${error?.message || error}`);
      });
    } catch (error) {
      if (!warned.has(label)) {
        warned.add(label);
        console.warn(`[GTA Neon City] ${label} audio unavailable: ${error?.message || error}`);
      }
    }
  }

  function createElement(file, loop = false, volume = 0, label = "audio") {
    const element = audioFactory(file, label);
    if (!element) throw new Error(`Audio factory did not create ${label}`);
    elementAllocations += 1;
    sourceLoads += 1;
    element.preload = "auto";
    element.loop = Boolean(loop);
    element.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    allElements.push(element);
    readyPromises.push(waitForAudioReady(element));
    return element;
  }

  for (const [name, file] of Object.entries(files)) {
    elements[name] = createElement(file, loopNames.has(name), name === "ambience" ? 0.13 : 0, `flat:${name}`);
  }

  const spatialPools = {};
  for (const [name, count] of Object.entries(SPATIAL_VOICE_COUNTS)) {
    const pair = spatialFiles[name];
    if (!pair?.left || !pair?.right) throw new Error(`Missing prebuilt stereo pair for ${name}`);
    spatialPools[name] = createSpatialVoicePool({
      name,
      count,
      leftFile: pair.left,
      rightFile: pair.right,
      createElement,
      playElement: safePlayElement,
    });
  }
  const sirenFiles = spatialFiles.siren;
  if (!sirenFiles?.left || !sirenFiles?.right) throw new Error("Missing prebuilt stereo pair for siren");
  const sirenPair = {
    left: createElement(sirenFiles.left, true, 0, "siren:left"),
    right: createElement(sirenFiles.right, true, 0, "siren:right"),
  };

  // Native Audio opens and decodes local WAVs in the constructor's load
  // microtask. Await every handle before returning so main cannot publish READY
  // while a gameplay voice still has a first-use file open pending.
  await Promise.all(readyPromises);
  filesReady = true;
  const startupElementCount = elementAllocations;
  const startupSourceLoads = sourceLoads;
  const listener = createSpatialListenerState();
  const spatialMix = { sourceX: 0, sourceY: 0, sourceZ: 0, distance: 0, pan: 0, attenuation: 0, leftGain: 0, rightGain: 0, accepted: false };
  const sirenMix = { sourceX: 0, sourceY: 0, sourceZ: 0, distance: 0, pan: 0, attenuation: 0, leftGain: 0, rightGain: 0, accepted: false };
  const lastSpatialEvent = {
    serial: 0,
    name: null,
    sourceX: 0,
    sourceY: 0,
    sourceZ: 0,
    distance: 0,
    pan: 0,
    attenuation: 0,
    leftGain: 0,
    rightGain: 0,
    accepted: false,
    voiceIndex: -1,
    stolen: false,
  };
  const sirenState = {
    sourceId: null,
    active: false,
    audible: false,
    distance: 0,
    pan: 0,
    attenuation: 0,
    leftGain: 0,
    rightGain: 0,
  };
  const pairCounts = Object.freeze({ ...SPATIAL_VOICE_COUNTS, siren: 1 });
  const precreatedVoicePairs = Object.values(pairCounts).reduce((sum, count) => sum + count, 0);

  function start() {
    if (started || disposed) return;
    started = true;
    for (const name of ["ambience", "cityDay", "cityNight", "engine", "rain", "tire"]) {
      safePlayElement(elements[name], `flat:${name}`);
    }
    // The sole siren loop is started silently now; wanted-state changes only
    // alter its two gains and never create/open/play a new source mid-game.
    safePlayElement(sirenPair.left, "siren:left");
    safePlayElement(sirenPair.right, "siren:right");
  }

  function play(name, volume = 0.65) {
    const element = elements[name];
    if (!element || !oneShots.has(name) || disposed) return false;
    element.pause?.();
    element.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    element.currentTime = 0;
    safePlayElement(element, `flat:${name}`);
    return true;
  }

  function updateListener(position, forward, up) {
    return updateSpatialListener(listener, position, forward, up);
  }

  function playAt(name, volume = 0.65, worldPosition = null) {
    lastSpatialEvent.serial += 1;
    lastSpatialEvent.name = String(name ?? "");
    const profile = SPATIAL_AUDIO_PROFILES[lastSpatialEvent.name];
    const pool = spatialPools[lastSpatialEvent.name];
    if (!profile || !pool || disposed || !worldPosition) {
      lastSpatialEvent.sourceX = finiteComponent(worldPosition, "x", 0);
      lastSpatialEvent.sourceY = finiteComponent(worldPosition, "y", 1);
      lastSpatialEvent.sourceZ = finiteComponent(worldPosition, "z", 2);
      lastSpatialEvent.distance = 0;
      lastSpatialEvent.pan = 0;
      lastSpatialEvent.attenuation = 0;
      lastSpatialEvent.leftGain = 0;
      lastSpatialEvent.rightGain = 0;
      lastSpatialEvent.accepted = false;
      lastSpatialEvent.voiceIndex = -1;
      lastSpatialEvent.stolen = false;
      return lastSpatialEvent;
    }
    calculateSpatialMix(listener, worldPosition, profile, volume, spatialMix);
    lastSpatialEvent.sourceX = spatialMix.sourceX;
    lastSpatialEvent.sourceY = spatialMix.sourceY;
    lastSpatialEvent.sourceZ = spatialMix.sourceZ;
    lastSpatialEvent.distance = spatialMix.distance;
    lastSpatialEvent.pan = spatialMix.pan;
    lastSpatialEvent.attenuation = spatialMix.attenuation;
    lastSpatialEvent.leftGain = spatialMix.leftGain;
    lastSpatialEvent.rightGain = spatialMix.rightGain;
    lastSpatialEvent.accepted = spatialMix.accepted;
    lastSpatialEvent.voiceIndex = pool.trigger(spatialMix);
    lastSpatialEvent.stolen = pool.lastStolen;
    return lastSpatialEvent;
  }

  function updateSiren(wantedStars, sourcePosition, sourceId) {
    const activeSource = Number(wantedStars) > 0 && sourcePosition;
    if (activeSource) {
      const volume = Math.min(0.48, 0.19 + Math.max(0, Number(wantedStars) || 0) * 0.055);
      calculateSpatialMix(listener, sourcePosition, SPATIAL_AUDIO_PROFILES.siren, volume, sirenMix);
      sirenPair.left.volume = sirenMix.leftGain;
      sirenPair.right.volume = sirenMix.rightGain;
      sirenState.sourceId = sourceId === null || sourceId === undefined ? "police" : String(sourceId);
      sirenState.active = true;
      sirenState.audible = sirenMix.accepted;
      sirenState.distance = sirenMix.distance;
      sirenState.pan = sirenMix.pan;
      sirenState.attenuation = sirenMix.attenuation;
      sirenState.leftGain = sirenMix.leftGain;
      sirenState.rightGain = sirenMix.rightGain;
    } else {
      sirenPair.left.volume = 0;
      sirenPair.right.volume = 0;
      sirenState.sourceId = null;
      sirenState.active = false;
      sirenState.audible = false;
      sirenState.distance = 0;
      sirenState.pan = 0;
      sirenState.attenuation = 0;
      sirenState.leftGain = 0;
      sirenState.rightGain = 0;
    }
  }

  function update({
    driving = false,
    speed = 0,
    wantedStars = 0,
    rain = 0,
    tireSlip = 0,
    timeHours = 12,
    sirenPosition = null,
    sirenSourceId = null,
  } = {}) {
    start();
    const engine = elements.engine;
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
    rainfall.volume = Math.min(0.28, wetness * 0.25);
    tire.volume = driving ? Math.min(0.24, Math.max(0, Number(tireSlip) || 0) * 0.22) : 0;
    tire.playbackRate = 0.82 + normalizedSpeed * 0.72;
    dayBed.volume = (0.018 + solar * 0.105) * outsideMix;
    nightBed.volume = (0.012 + night * 0.082) * outsideMix;
    updateSiren(wantedStars, sirenPosition, sirenSourceId);
  }

  function snapshot() {
    const event = Object.freeze({ ...lastSpatialEvent });
    const siren = Object.freeze({ ...sirenState });
    return Object.freeze({
      backend: "native-html-audio-stereo-file-pairs",
      policy: "startup-preloaded-fixed-stereo-pairs",
      filesReady,
      startupElementCount,
      currentElementCount: allElements.length,
      precreatedElementCount: startupElementCount,
      startupSourceLoads,
      currentSourceLoads: sourceLoads,
      runtimeElementAllocations: elementAllocations - startupElementCount,
      runtimeSourceLoads: sourceLoads - startupSourceLoads,
      precreatedVoicePairs,
      pairCounts,
      listener: Object.freeze({
        revision: listener.revision,
        position: Object.freeze([listener.position.x, listener.position.y, listener.position.z]),
        forward: Object.freeze([listener.forward.x, listener.forward.y, listener.forward.z]),
        up: Object.freeze([listener.up.x, listener.up.y, listener.up.z]),
        right: Object.freeze([listener.right.x, listener.right.y, listener.right.z]),
      }),
      lastSpatialEvent: event,
      activeSirenSource: siren.sourceId,
      siren,
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    sirenPair.left.volume = 0;
    sirenPair.right.volume = 0;
    for (const element of allElements) element.close?.();
  }

  return {
    files,
    spatialFiles,
    elements,
    spatialPools,
    start,
    play,
    playAt,
    updateListener,
    update,
    snapshot,
    dispose,
  };
}
