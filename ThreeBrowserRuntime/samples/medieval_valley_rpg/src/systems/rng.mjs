/**
 * Small deterministic PRNG used by simulation systems and tests.
 *
 * The implementation is platform-independent: state is always reduced to an
 * unsigned 32-bit integer and no wall-clock data is consulted.
 */
export class SeededRng {
  constructor(seed = 0x6d2b79f5) {
    this.state = normalizeSeed(seed);
  }

  nextUint32() {
    // Mulberry32. Math.imul gives identical 32-bit multiplication in Node and
    // the runtime's V8 build.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next() {
    return this.nextUint32() / 0x1_0000_0000;
  }

  float(min = 0, max = 1) {
    assertFinite(min, "min");
    assertFinite(max, "max");
    if (max < min) throw new RangeError("max must be greater than or equal to min");
    return min + (max - min) * this.next();
  }

  int(min, maxInclusive) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(maxInclusive)) {
      throw new TypeError("int bounds must be safe integers");
    }
    if (maxInclusive < min) throw new RangeError("maxInclusive must be greater than or equal to min");
    const span = maxInclusive - min + 1;
    if (span <= 0 || span > 0x1_0000_0000) throw new RangeError("integer range is too large");
    return min + Math.floor(this.next() * span);
  }

  chance(probability) {
    assertFinite(probability, "probability");
    if (probability < 0 || probability > 1) throw new RangeError("probability must be in [0, 1]");
    return this.next() < probability;
  }

  pick(values) {
    if (!Array.isArray(values) || values.length === 0) throw new RangeError("pick requires a non-empty array");
    return values[this.int(0, values.length - 1)];
  }

  weighted(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new RangeError("weighted requires a non-empty array");
    }
    const total = entries.reduce((sum, entry) => {
      const weight = Number(entry.weight);
      if (!Number.isFinite(weight) || weight < 0) throw new RangeError("weights must be finite and non-negative");
      return sum + weight;
    }, 0);
    if (total <= 0) throw new RangeError("at least one weight must be positive");
    let cursor = this.float(0, total);
    for (const entry of entries) {
      cursor -= entry.weight;
      if (cursor < 0) return entry.value;
    }
    return entries.at(-1).value;
  }

  shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  fork(label) {
    return new SeededRng(`${this.state}:${String(label)}`);
  }

  snapshot() {
    return { state: this.state >>> 0 };
  }

  restore(snapshot) {
    if (!snapshot || !Number.isInteger(snapshot.state)) throw new TypeError("invalid RNG snapshot");
    this.state = snapshot.state >>> 0;
    return this;
  }
}

export function createSeededRng(seed) {
  return new SeededRng(seed);
}

export function normalizeSeed(seed) {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new TypeError("seed must be finite");
    return (Math.trunc(seed) >>> 0) || 0x9e3779b9;
  }
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x9e3779b9;
}

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}
