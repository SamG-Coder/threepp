/**
 * Deterministic, renderer-independent surface-fire model.
 *
 * The model deliberately advances on a fixed clock. A renderer may call
 * `advance()` with variable frame deltas without changing the resulting fire
 * history. Cell objects are allocated once and remain stable for the lifetime
 * of the model, so scene code can retain references to them.
 */

export const FIRE_STATES = Object.freeze({
  UNBURNED: "unburned",
  HEATING: "heating",
  BURNING: "burning",
  BURNED: "burned",
});

const VALID_STATES = new Set(Object.values(FIRE_STATES));
const UINT32_RANGE = 0x1_0000_0000;
const EPSILON = 1e-9;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positive(value, fallback, name) {
  const numeric = finite(value, fallback);
  if (!(numeric > 0)) throw new RangeError(`${name} must be greater than zero`);
  return numeric;
}

function dimension(value, fallback, name) {
  const numeric = Math.trunc(finite(value, fallback));
  if (numeric < 1 || numeric > 512) {
    throw new RangeError(`${name} must be an integer between 1 and 512`);
  }
  return numeric;
}

function seedFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  const text = String(value ?? "bushfire-mountainside");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hash01(seed, index, salt = 0) {
  let value = seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / UINT32_RANGE;
}

function readField(source, context, fallback, name) {
  let value;
  if (typeof source === "function") value = source(context);
  else if (Array.isArray(source) || ArrayBuffer.isView(source)) value = source[context.index];
  else value = source;
  const result = finite(value, fallback);
  if (!Number.isFinite(result)) throw new TypeError(`${name} produced a non-finite value`);
  return result;
}

function normalizeWind(input = {}) {
  const array = Array.isArray(input) || ArrayBuffer.isView(input);
  const rawX = finite(array ? input[0] : input.x, 1);
  const rawZ = finite(array ? input[1] : input.z, 0);
  const vectorLength = Math.hypot(rawX, rawZ);
  const directionX = vectorLength > EPSILON ? rawX / vectorLength : 1;
  const directionZ = vectorLength > EPSILON ? rawZ / vectorLength : 0;
  const inferredSpeed = array && input.length < 3 ? vectorLength : 5;
  const speed = clamp(finite(array ? input[2] : input.speed, inferredSpeed), 0, 50);
  return Object.freeze({ x: directionX, z: directionZ, speed });
}

function ignitionSpec(gridX, gridZ, options = {}) {
  return Object.freeze({
    gridX: Math.trunc(gridX),
    gridZ: Math.trunc(gridZ),
    radius: Math.max(0, Math.trunc(finite(options.radius, 0))),
    intensity: clamp(finite(options.intensity, 1), 0.05, 1),
  });
}

/**
 * Fixed-grid wildfire simulation for cinematic, minute-scale spread.
 *
 * `x` and `z` on every public cell are world-space cell centres. Their grid
 * coordinates are available as `gridX` and `gridZ`.
 */
export class WildfireModel {
  constructor(options = {}) {
    const width = dimension(options.width, 40, "width");
    const height = dimension(options.height, 28, "height");
    if (width * height > 131_072) {
      throw new RangeError("wildfire grid may contain at most 131072 cells");
    }

    const cellSize = positive(options.cellSize, 5, "cellSize");
    const fixedStepSeconds = positive(options.fixedStepSeconds, 1, "fixedStepSeconds");
    if (fixedStepSeconds > 5) throw new RangeError("fixedStepSeconds may not exceed 5 seconds");

    const originX = finite(options.originX, -width * cellSize * 0.5);
    const originZ = finite(options.originZ, -height * cellSize * 0.5);
    const seed = seedFrom(options.seed);

    this.config = Object.freeze({
      width,
      height,
      cellSize,
      originX,
      originZ,
      seed,
      fixedStepSeconds,
      spreadTimeSeconds: positive(options.spreadTimeSeconds, 72, "spreadTimeSeconds"),
      burnDurationSeconds: positive(options.burnDurationSeconds, 190, "burnDurationSeconds"),
      preheatRetentionSeconds: positive(
        options.preheatRetentionSeconds,
        240,
        "preheatRetentionSeconds",
      ),
      dryingRatePerSecond: clamp(finite(options.dryingRatePerSecond, 0.00085), 0, 0.05),
      windBiasPerSpeed: clamp(finite(options.windBiasPerSpeed, 0.16), 0, 1),
      maximumWindBias: clamp(finite(options.maximumWindBias, 2.2), 0, 4),
      uphillBias: clamp(finite(options.uphillBias, 3.4), 0, 12),
      maximumSlopeExponent: clamp(finite(options.maximumSlopeExponent, 1.65), 0, 4),
      ignitionThreshold: positive(options.ignitionThreshold, 1, "ignitionThreshold"),
      ignitionMoistureLimit: clamp(finite(options.ignitionMoistureLimit, 0.82), 0, 1),
      minimumFuel: clamp(finite(options.minimumFuel, 0.008), 0, 0.2),
    });

    this.wind = normalizeWind(options.wind ?? { x: 1, z: 0.18, speed: 5 });
    this.elapsedSeconds = 0;
    this.tick = 0;
    this.pendingSeconds = 0;
    this._ignitionPlan = [];
    this._exposure = new Float64Array(width * height);
    this._ignition = new Float64Array(width * height);
    this._burnAge = new Float64Array(width * height);
    this._initialFuel = new Float64Array(width * height);
    this._initialMoisture = new Float64Array(width * height);
    this._threshold = new Float64Array(width * height);
    this._burnRateVariation = new Float64Array(width * height);

    const fuelSource = options.fuel ?? 0.92;
    const moistureSource = options.moisture ?? 0.14;
    const elevationSource = options.elevation ?? 0;
    const cells = new Array(width * height);
    for (let gridZ = 0; gridZ < height; ++gridZ) {
      for (let gridX = 0; gridX < width; ++gridX) {
        const index = gridZ * width + gridX;
        const x = originX + (gridX + 0.5) * cellSize;
        const z = originZ + (gridZ + 0.5) * cellSize;
        const context = Object.freeze({ index, gridX, gridZ, x, z, width, height, cellSize });
        const fuel = clamp(readField(fuelSource, context, 0.92, "fuel"));
        const moisture = clamp(readField(moistureSource, context, 0.14, "moisture"));
        const elevation = finite(readField(elevationSource, context, 0, "elevation"), 0);
        const cell = Object.seal({
          index,
          x,
          z,
          gridX,
          gridZ,
          elevation,
          fuel,
          moisture,
          heat: 0,
          burn: 0,
          state: FIRE_STATES.UNBURNED,
        });
        cells[index] = cell;
        this._initialFuel[index] = fuel;
        this._initialMoisture[index] = moisture;
        this._threshold[index] = this.config.ignitionThreshold
          * (0.86 + hash01(seed, index, 0xa511e9b3) * 0.28);
        this._burnRateVariation[index] = 0.9 + hash01(seed, index, 0x63d83595) * 0.2;
      }
    }
    this.cells = Object.freeze(cells);

    this._neighbors = Object.freeze([
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],             [1, 0],
      [-1, 1],  [0, 1],   [1, 1],
    ].map(([dx, dz]) => {
      const distance = Math.hypot(dx, dz);
      return Object.freeze({ dx, dz, distance, directionX: dx / distance, directionZ: dz / distance });
    }));

    for (const source of options.ignitions ?? []) {
      if (source?.world) {
        this.igniteWorld(source.x, source.z, source);
      } else {
        this.ignite(source.gridX ?? source.x, source.gridZ ?? source.z, source);
      }
    }
  }

  get width() {
    return this.config.width;
  }

  get height() {
    return this.config.height;
  }

  get worldBounds() {
    return Object.freeze({
      minX: this.config.originX,
      maxX: this.config.originX + this.width * this.config.cellSize,
      minZ: this.config.originZ,
      maxZ: this.config.originZ + this.height * this.config.cellSize,
    });
  }

  get ignitionPlan() {
    return this._ignitionPlan.map(source => ({ ...source }));
  }

  setWind(wind) {
    this.wind = normalizeWind(wind);
    return this.wind;
  }

  cellAtGrid(gridX, gridZ) {
    const x = Math.trunc(finite(gridX, -1));
    const z = Math.trunc(finite(gridZ, -1));
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return null;
    return this.cells[z * this.width + x];
  }

  cellAtWorld(x, z) {
    const worldX = finite(x, Number.NaN);
    const worldZ = finite(z, Number.NaN);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
    const gridX = Math.floor((worldX - this.config.originX) / this.config.cellSize);
    const gridZ = Math.floor((worldZ - this.config.originZ) / this.config.cellSize);
    return this.cellAtGrid(gridX, gridZ);
  }

  /** Ignite a grid cell and an optional radius measured in grid cells. */
  ignite(gridX, gridZ, options = {}) {
    const center = this.cellAtGrid(gridX, gridZ);
    if (!center) return 0;
    const spec = ignitionSpec(center.gridX, center.gridZ, options);
    const ignited = this._applyIgnition(spec);
    if (options.record !== false && ignited > 0) this._ignitionPlan.push(spec);
    return ignited;
  }

  /** Ignite around a world-space point. Radius remains measured in cells. */
  igniteWorld(x, z, options = {}) {
    const center = this.cellAtWorld(x, z);
    if (!center) return 0;
    return this.ignite(center.gridX, center.gridZ, options);
  }

  _applyIgnition(spec) {
    let ignited = 0;
    const radiusSquared = spec.radius * spec.radius;
    for (let dz = -spec.radius; dz <= spec.radius; ++dz) {
      for (let dx = -spec.radius; dx <= spec.radius; ++dx) {
        if (dx * dx + dz * dz > radiusSquared) continue;
        const cell = this.cellAtGrid(spec.gridX + dx, spec.gridZ + dz);
        if (cell && this._igniteIndex(cell.index, spec.intensity)) ignited += 1;
      }
    }
    return ignited;
  }

  _igniteIndex(index, intensity) {
    const cell = this.cells[index];
    if (cell.state === FIRE_STATES.BURNING || cell.state === FIRE_STATES.BURNED) return false;
    if (cell.fuel <= this.config.minimumFuel) return false;
    cell.state = FIRE_STATES.BURNING;
    cell.heat = clamp(0.76 + intensity * 0.24);
    cell.burn = clamp(0.12 + intensity * 0.18);
    this._ignition[index] = this._threshold[index];
    this._burnAge[index] = 0;
    return true;
  }

  /**
   * Restore initial fuel and moisture while retaining stable cell identities.
   * Recorded ignition points are retained unless `clearIgnitions` is true.
   */
  reset({ reignite = false, clearIgnitions = false } = {}) {
    const plan = clearIgnitions ? [] : [...this._ignitionPlan];
    if (clearIgnitions) this._ignitionPlan.length = 0;
    this.elapsedSeconds = 0;
    this.tick = 0;
    this.pendingSeconds = 0;
    this._exposure.fill(0);
    this._ignition.fill(0);
    this._burnAge.fill(0);
    for (const cell of this.cells) {
      cell.fuel = this._initialFuel[cell.index];
      cell.moisture = this._initialMoisture[cell.index];
      cell.heat = 0;
      cell.burn = 0;
      cell.state = FIRE_STATES.UNBURNED;
    }
    if (reignite) {
      for (const source of plan) this._applyIgnition(source);
    }
    return this;
  }

  /** Reset and replay every ignition point recorded through `ignite()`. */
  reignite() {
    return this.reset({ reignite: true });
  }

  clearIgnitions() {
    this._ignitionPlan.length = 0;
    return this;
  }

  /** Advance by real seconds; all actual simulation happens on fixed ticks. */
  advance(deltaSeconds) {
    const delta = finite(deltaSeconds, Number.NaN);
    if (!Number.isFinite(delta) || delta < 0) {
      throw new RangeError("deltaSeconds must be a finite non-negative number");
    }
    if (delta > 86_400) throw new RangeError("one advance may not exceed 24 simulated hours");
    this.pendingSeconds += delta;
    const step = this.config.fixedStepSeconds;
    const steps = Math.floor((this.pendingSeconds + EPSILON) / step);
    if (steps === 0) return this.stats();
    this.pendingSeconds -= steps * step;
    if (Math.abs(this.pendingSeconds) < EPSILON) this.pendingSeconds = 0;
    for (let index = 0; index < steps; ++index) this._step(step);
    return this.stats();
  }

  _step(deltaSeconds) {
    this._exposure.fill(0);
    const {
      spreadTimeSeconds,
      windBiasPerSpeed,
      maximumWindBias,
      uphillBias,
      maximumSlopeExponent,
      minimumFuel,
    } = this.config;
    const windBias = Math.min(maximumWindBias, this.wind.speed * windBiasPerSpeed);

    // Gather heat from the old tick before mutating any cell. This makes the
    // result independent of row traversal order and prevents instant chains.
    for (const source of this.cells) {
      if (source.state !== FIRE_STATES.BURNING || source.fuel <= minimumFuel) continue;
      const sourceStrength = Math.max(0.08, source.burn) * (0.56 + source.heat * 0.44);
      for (const neighbor of this._neighbors) {
        const gridX = source.gridX + neighbor.dx;
        const gridZ = source.gridZ + neighbor.dz;
        const target = this.cellAtGrid(gridX, gridZ);
        if (!target || target.state === FIRE_STATES.BURNING || target.state === FIRE_STATES.BURNED) continue;
        if (target.fuel <= minimumFuel) continue;

        const alignment = neighbor.directionX * this.wind.x + neighbor.directionZ * this.wind.z;
        const windFactor = clamp(Math.exp(alignment * windBias), 0.12, 5);
        const run = this.config.cellSize * neighbor.distance;
        const slope = (target.elevation - source.elevation) / run;
        const slopeExponent = clamp(slope * uphillBias, -maximumSlopeExponent, maximumSlopeExponent);
        const slopeFactor = Math.exp(slopeExponent);
        const dryness = clamp(1 - target.moisture * 0.9, 0.04, 1);
        const moistureFactor = Math.pow(dryness, 1.5);
        const fuelFactor = 0.25 + clamp(target.fuel) * 0.75;
        const distanceFactor = 1 / neighbor.distance;
        this._exposure[target.index] += sourceStrength * windFactor * slopeFactor
          * moistureFactor * fuelFactor * distanceFactor / spreadTimeSeconds;
      }
    }

    const retention = Math.exp(-deltaSeconds / this.config.preheatRetentionSeconds);
    for (const cell of this.cells) {
      const index = cell.index;
      if (cell.state === FIRE_STATES.BURNING) {
        this._advanceBurningCell(cell, deltaSeconds);
        continue;
      }
      if (cell.state === FIRE_STATES.BURNED) {
        cell.burn = 0;
        cell.heat = clamp(cell.heat * Math.exp(-deltaSeconds / 55));
        continue;
      }

      this._ignition[index] = this._ignition[index] * retention
        + this._exposure[index] * deltaSeconds;
      const threshold = this._threshold[index];
      const preheat = clamp(this._ignition[index] / threshold);
      if (this._exposure[index] > 0) {
        const drying = this.config.dryingRatePerSecond * preheat
          * (0.5 + Math.min(2, this._exposure[index] * spreadTimeSeconds));
        cell.moisture = clamp(cell.moisture - drying * deltaSeconds);
      }
      cell.heat = clamp(preheat * 0.72);

      if (this._ignition[index] >= threshold
          && cell.moisture <= this.config.ignitionMoistureLimit
          && cell.fuel > minimumFuel) {
        this._igniteIndex(index, 1);
      } else {
        cell.burn = 0;
        cell.state = preheat > 0.012 ? FIRE_STATES.HEATING : FIRE_STATES.UNBURNED;
      }
    }

    this.tick += 1;
    this.elapsedSeconds = this.tick * this.config.fixedStepSeconds;
  }

  _advanceBurningCell(cell, deltaSeconds) {
    const index = cell.index;
    this._burnAge[index] += deltaSeconds;
    cell.moisture = clamp(
      cell.moisture - this.config.dryingRatePerSecond * (0.65 + cell.burn) * deltaSeconds * 2.2,
    );
    const initialFuel = Math.max(this._initialFuel[index], EPSILON);
    const ramp = 1 - Math.exp(-this._burnAge[index] / 7);
    const remaining = clamp(cell.fuel / initialFuel);
    const tail = clamp(remaining / 0.16);
    const oxygen = 0.78 + (1 - cell.moisture) * 0.22;
    cell.burn = clamp(ramp * tail * oxygen * (0.94 + (this._burnRateVariation[index] - 1) * 0.3));
    cell.heat = clamp(0.34 + cell.burn * 0.66);

    const fuelPerSecond = initialFuel / this.config.burnDurationSeconds;
    const loss = fuelPerSecond * (0.62 + cell.burn * 0.72)
      * (1 - cell.moisture * 0.3) * this._burnRateVariation[index] * deltaSeconds;
    cell.fuel = clamp(cell.fuel - loss);
    if (cell.fuel <= this.config.minimumFuel) {
      cell.fuel = 0;
      cell.burn = 0;
      cell.heat = 0.34;
      cell.state = FIRE_STATES.BURNED;
    }
  }

  stats() {
    const counts = {
      [FIRE_STATES.UNBURNED]: 0,
      [FIRE_STATES.HEATING]: 0,
      [FIRE_STATES.BURNING]: 0,
      [FIRE_STATES.BURNED]: 0,
    };
    let totalFuel = 0;
    let initialFuel = 0;
    let totalMoisture = 0;
    let totalHeat = 0;
    let maxBurn = 0;
    let activeX = 0;
    let activeZ = 0;
    let activeWeight = 0;
    for (const cell of this.cells) {
      counts[cell.state] += 1;
      totalFuel += cell.fuel;
      initialFuel += this._initialFuel[cell.index];
      totalMoisture += cell.moisture;
      totalHeat += cell.heat;
      maxBurn = Math.max(maxBurn, cell.burn);
      const weight = cell.burn + (cell.state === FIRE_STATES.HEATING ? cell.heat * 0.2 : 0);
      activeX += cell.x * weight;
      activeZ += cell.z * weight;
      activeWeight += weight;
    }
    const fuelConsumed = Math.max(0, initialFuel - totalFuel);
    return Object.freeze({
      elapsedSeconds: this.elapsedSeconds,
      tick: this.tick,
      pendingSeconds: this.pendingSeconds,
      cellCount: this.cells.length,
      unburned: counts.unburned,
      heating: counts.heating,
      burning: counts.burning,
      burned: counts.burned,
      active: counts.heating + counts.burning,
      totalFuel,
      initialFuel,
      fuelConsumed,
      fuelFraction: initialFuel > 0 ? clamp(totalFuel / initialFuel) : 0,
      burnedFraction: clamp(counts.burned / this.cells.length),
      meanMoisture: totalMoisture / this.cells.length,
      meanHeat: totalHeat / this.cells.length,
      maxBurn,
      activeCenterX: activeWeight > EPSILON ? activeX / activeWeight : null,
      activeCenterZ: activeWeight > EPSILON ? activeZ / activeWeight : null,
    });
  }

  snapshot() {
    return {
      version: 1,
      width: this.width,
      height: this.height,
      cellSize: this.config.cellSize,
      originX: this.config.originX,
      originZ: this.config.originZ,
      seed: this.config.seed,
      elapsedSeconds: this.elapsedSeconds,
      tick: this.tick,
      pendingSeconds: this.pendingSeconds,
      wind: { ...this.wind },
      ignitionPlan: this.ignitionPlan,
      cells: this.cells.map(cell => ({
        index: cell.index,
        x: cell.x,
        z: cell.z,
        gridX: cell.gridX,
        gridZ: cell.gridZ,
        elevation: cell.elevation,
        fuel: cell.fuel,
        moisture: cell.moisture,
        heat: cell.heat,
        burn: cell.burn,
        state: cell.state,
      })),
      stats: { ...this.stats() },
    };
  }

  /** Catch accidental renderer writes during development and tests. */
  validate() {
    for (const cell of this.cells) {
      if (!VALID_STATES.has(cell.state)) throw new Error(`invalid fire state at cell ${cell.index}`);
      for (const property of ["fuel", "moisture", "heat", "burn"]) {
        const value = cell[property];
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error(`${property} escaped [0, 1] at cell ${cell.index}`);
        }
      }
    }
    return true;
  }
}

export const BushfireModel = WildfireModel;
export default WildfireModel;
