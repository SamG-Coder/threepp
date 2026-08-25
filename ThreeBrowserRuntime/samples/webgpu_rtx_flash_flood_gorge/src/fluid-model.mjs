/**
 * Deterministic, renderer-independent shallow-water model for a long gorge.
 *
 * X runs across the gorge and increasing Z runs downstream. State is stored in
 * cell-centred typed arrays so a renderer can upload it without allocating per
 * frame. All integration happens on a fixed clock; variable render-frame
 * partitions therefore produce the same water history.
 */

const EPSILON = 1e-10;

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

function nonNegative(value, fallback, name) {
  const numeric = finite(value, fallback);
  if (numeric < 0) throw new RangeError(`${name} must be non-negative`);
  return numeric;
}

function dimension(value, fallback, name) {
  const numeric = Math.trunc(finite(value, fallback));
  if (numeric < 2 || numeric > 512) {
    throw new RangeError(`${name} must be an integer between 2 and 512`);
  }
  return numeric;
}

function smootherStep(value) {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function readField(source, context, fallback, name) {
  let value;
  if (typeof source === "function") value = source(context);
  else if (Array.isArray(source) || ArrayBuffer.isView(source)) value = source[context.index];
  else value = source;
  if (value === undefined || value === null) value = fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError(`${name} produced a non-finite value`);
  return numeric;
}

function defaultGorgeBed(context) {
  const downstream = context.gridZ * context.cellSize;
  const zPhase = context.gridZ / Math.max(1, context.height - 1);
  const meander = Math.sin(zPhase * Math.PI * 5.2) * 0.065;
  const across = (context.gridX + 0.5) / context.width - 0.5 - meander;
  const channel = Math.abs(across) / 0.5;
  const inner = Math.max(0, channel - 0.18) / 0.82;
  const banks = Math.pow(inner, 2.35) * 21;
  const bedDetail = Math.sin(context.gridZ * 0.19 + context.gridX * 0.31) * 0.08;
  return banks - downstream * 0.012 + bedDetail;
}

/** Stable cell metadata with live accessors into the model's typed arrays. */
class WaterCellView {
  constructor(model, index, gridX, gridZ, x, z) {
    Object.defineProperty(this, "_model", { value: model, enumerable: false });
    this.index = index;
    this.gridX = gridX;
    this.gridZ = gridZ;
    this.x = x;
    this.z = z;
    Object.freeze(this);
  }

  get bed() { return this._model.bed[this.index]; }
  get depth() { return this._model.depth[this.index]; }
  get surface() { return this._model.surface[this.index]; }
  get velocityX() { return this._model.velocityX[this.index]; }
  get velocityZ() { return this._model.velocityZ[this.index]; }
  get speed() { return this._model.speed[this.index]; }
  get foam() { return this._model.foam[this.index]; }
  get turbulence() { return this._model.turbulence[this.index]; }
  get wet() { return this._model.wetMask[this.index] !== 0; }
  get wetAge() { return this._model.wetAge[this.index]; }
}

/**
 * Fixed-grid flash-flood solver using a positivity-limited local-inertial flux.
 *
 * The gate occupies part of the upstream (minimum-Z) boundary. Its default
 * hydrograph opens smoothly, holds, and then closes. Pass `gateHydrograph` to
 * provide a custom total discharge in cubic metres per second.
 */
export class FlashFloodModel {
  constructor(options = {}) {
    const width = dimension(options.width, 96, "width");
    const height = dimension(options.height, 240, "height");
    if (width * height > 131_072) {
      throw new RangeError("fluid grid may contain at most 131072 cells");
    }

    const cellSize = positive(options.cellSize, 4, "cellSize");
    const fixedStepSeconds = positive(options.fixedStepSeconds, 0.05, "fixedStepSeconds");
    if (fixedStepSeconds > 0.25) {
      throw new RangeError("fixedStepSeconds may not exceed 0.25 seconds");
    }

    const originX = finite(options.originX, -width * cellSize * 0.5);
    const originZ = finite(options.originZ, -height * cellSize * 0.5);
    const maxDepth = positive(options.maxDepth, 12, "maxDepth");
    const maxVelocity = positive(options.maxVelocity, 18, "maxVelocity");
    const dryDepth = positive(options.dryDepth, 0.0025, "dryDepth");
    const wetDepth = positive(options.wetDepth, 0.018, "wetDepth");
    if (wetDepth > maxDepth) throw new RangeError("wetDepth may not exceed maxDepth");

    const requestedGateWidth = Math.trunc(finite(
      options.gateWidthCells,
      Math.max(3, Math.round(width * 0.24)),
    ));
    const gateWidthCells = clamp(requestedGateWidth, 1, width);
    let gateCenterGridX = Math.trunc(finite(options.gateCenterGridX, Math.floor(width * 0.5)));
    if (Number.isFinite(Number(options.gateCenterX))) {
      gateCenterGridX = Math.floor((Number(options.gateCenterX) - originX) / cellSize);
    }
    gateCenterGridX = clamp(gateCenterGridX, 0, width - 1);
    let gateStartX = clamp(Math.round(gateCenterGridX - (gateWidthCells - 1) * 0.5), 0, width - gateWidthCells);
    gateStartX = Math.trunc(gateStartX);
    const gateEndX = gateStartX + gateWidthCells - 1;

    const gateHoldInput = options.gateHoldSeconds;
    const gateHoldSeconds = gateHoldInput === Infinity
      ? Infinity
      : nonNegative(gateHoldInput, 150, "gateHoldSeconds");

    this.config = Object.freeze({
      width,
      height,
      cellSize,
      originX,
      originZ,
      fixedStepSeconds,
      gravity: positive(options.gravity, 9.81, "gravity"),
      maxDepth,
      maxVelocity,
      maximumFroude: positive(options.maximumFroude, 2.25, "maximumFroude"),
      dryDepth,
      wetDepth,
      manningRoughness: nonNegative(options.manningRoughness, 0.034, "manningRoughness"),
      linearDamping: nonNegative(options.linearDamping, 0.018, "linearDamping"),
      outflowFroude: clamp(finite(options.outflowFroude, 0.82), 0, 2.5),
      outflowRelaxSeconds: positive(options.outflowRelaxSeconds, 0.7, "outflowRelaxSeconds"),
      foamBuildSeconds: positive(options.foamBuildSeconds, 0.32, "foamBuildSeconds"),
      foamDecaySeconds: positive(options.foamDecaySeconds, 7.5, "foamDecaySeconds"),
      turbulenceResponseSeconds: positive(
        options.turbulenceResponseSeconds,
        0.24,
        "turbulenceResponseSeconds",
      ),
      gateStartSeconds: nonNegative(options.gateStartSeconds, 1.5, "gateStartSeconds"),
      gateRiseSeconds: positive(options.gateRiseSeconds, 7, "gateRiseSeconds"),
      gateHoldSeconds,
      gateFallSeconds: positive(options.gateFallSeconds, 20, "gateFallSeconds"),
      gatePeakDischarge: nonNegative(
        options.gatePeakDischarge,
        Math.max(90, gateWidthCells * cellSize * 8.5),
        "gatePeakDischarge",
      ),
      gateWidthCells,
      gateStartX,
      gateEndX,
    });

    this.elapsedSeconds = 0;
    this.tick = 0;
    this.pendingSeconds = 0;
    this._hydrograph = typeof options.gateHydrograph === "function"
      ? options.gateHydrograph
      : null;

    const count = width * height;
    this.bed = new Float64Array(count);
    this.depth = new Float64Array(count);
    this.surface = new Float64Array(count);
    this.velocityX = new Float64Array(count);
    this.velocityZ = new Float64Array(count);
    this.speed = new Float64Array(count);
    this.foam = new Float64Array(count);
    this.turbulence = new Float64Array(count);
    this.wetAge = new Float64Array(count);
    this.wetMask = new Uint8Array(count);
    this.everWetMask = new Uint8Array(count);

    this._initialDepth = new Float64Array(count);
    this._initialVelocityX = new Float64Array(count);
    this._initialVelocityZ = new Float64Array(count);
    this._oldDepth = new Float64Array(count);
    this._outgoingRate = new Float64Array(count);
    this._outgoingScale = new Float64Array(count);
    this._fluxX = new Float64Array((width + 1) * height);
    this._fluxZ = new Float64Array(width * (height + 1));

    const bedSource = options.bed ?? options.terrainBed ?? defaultGorgeBed;
    const initialDepthSource = options.initialDepth ?? 0;
    const initialVelocityXSource = options.initialVelocityX ?? 0;
    const initialVelocityZSource = options.initialVelocityZ ?? 0;
    const cells = new Array(count);
    for (let gridZ = 0; gridZ < height; ++gridZ) {
      for (let gridX = 0; gridX < width; ++gridX) {
        const index = gridZ * width + gridX;
        const x = originX + (gridX + 0.5) * cellSize;
        const z = originZ + (gridZ + 0.5) * cellSize;
        const context = Object.freeze({
          index, gridX, gridZ, x, z, width, height, cellSize, originX, originZ,
        });
        const bed = readField(bedSource, context, 0, "bed");
        const depth = clamp(
          readField(initialDepthSource, context, 0, "initialDepth"),
          0,
          maxDepth,
        );
        const velocityX = clamp(
          readField(initialVelocityXSource, context, 0, "initialVelocityX"),
          -maxVelocity,
          maxVelocity,
        );
        const velocityZ = clamp(
          readField(initialVelocityZSource, context, 0, "initialVelocityZ"),
          -maxVelocity,
          maxVelocity,
        );
        this.bed[index] = bed;
        this.depth[index] = depth;
        this.surface[index] = bed + depth;
        this.velocityX[index] = velocityX;
        this.velocityZ[index] = velocityZ;
        this.speed[index] = Math.hypot(velocityX, velocityZ);
        this.wetMask[index] = depth >= wetDepth ? 1 : 0;
        this.everWetMask[index] = this.wetMask[index];
        this._initialDepth[index] = depth;
        this._initialVelocityX[index] = velocityX;
        this._initialVelocityZ[index] = velocityZ;
        cells[index] = new WaterCellView(this, index, gridX, gridZ, x, z);
      }
    }
    this.cells = Object.freeze(cells);

    this.gate = Object.freeze({
      startGridX: gateStartX,
      endGridX: gateEndX,
      centerGridX: (gateStartX + gateEndX) * 0.5,
      cellCount: gateWidthCells,
      width: gateWidthCells * cellSize,
      z: originZ,
    });

    this._initialVolume = this._sumVolume();
    this._injectedVolume = 0;
    this._outflowVolume = 0;
    this._overflowVolume = 0;
    this._newlyWetCells = 0;
  }

  get width() { return this.config.width; }
  get height() { return this.config.height; }
  get cellSize() { return this.config.cellSize; }
  get originX() { return this.config.originX; }
  get originZ() { return this.config.originZ; }

  get worldBounds() {
    return Object.freeze({
      minX: this.originX,
      maxX: this.originX + this.width * this.cellSize,
      minZ: this.originZ,
      maxZ: this.originZ + this.height * this.cellSize,
    });
  }

  indexAtGrid(gridX, gridZ) {
    const x = Math.trunc(finite(gridX, -1));
    const z = Math.trunc(finite(gridZ, -1));
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return -1;
    return z * this.width + x;
  }

  cellAtGrid(gridX, gridZ) {
    const index = this.indexAtGrid(gridX, gridZ);
    return index < 0 ? null : this.cells[index];
  }

  cellAtWorld(x, z) {
    const worldX = Number(x);
    const worldZ = Number(z);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
    return this.cellAtGrid(
      Math.floor((worldX - this.originX) / this.cellSize),
      Math.floor((worldZ - this.originZ) / this.cellSize),
    );
  }

  /** Smooth default gate opening in [0, 1]. */
  gateOpeningAt(timeSeconds = this.elapsedSeconds) {
    const time = Math.max(0, finite(timeSeconds, 0));
    const start = this.config.gateStartSeconds;
    if (time <= start) return 0;
    const riseEnd = start + this.config.gateRiseSeconds;
    if (time < riseEnd) return smootherStep((time - start) / this.config.gateRiseSeconds);
    const closeStart = riseEnd + this.config.gateHoldSeconds;
    if (time <= closeStart) return 1;
    const closeEnd = closeStart + this.config.gateFallSeconds;
    if (time < closeEnd) return 1 - smootherStep((time - closeStart) / this.config.gateFallSeconds);
    return 0;
  }

  /** Total upstream discharge in cubic metres per second. */
  gateDischargeAt(timeSeconds = this.elapsedSeconds) {
    const time = Math.max(0, finite(timeSeconds, 0));
    const opening = this.gateOpeningAt(time);
    if (!this._hydrograph) return this.config.gatePeakDischarge * opening;
    const value = Number(this._hydrograph(Object.freeze({
      time,
      opening,
      peakDischarge: this.config.gatePeakDischarge,
      gateWidth: this.gate.width,
    })));
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("gateHydrograph must return a finite non-negative discharge");
    }
    return value;
  }

  /** Advance real seconds while integrating only complete fixed ticks. */
  advance(deltaSeconds) {
    const delta = Number(deltaSeconds);
    if (!Number.isFinite(delta) || delta < 0) {
      throw new RangeError("deltaSeconds must be a finite non-negative number");
    }
    if (delta > 3_600) throw new RangeError("one advance may not exceed one simulated hour");
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
    const discharge = this.gateDischargeAt(this.elapsedSeconds + deltaSeconds * 0.5);
    this._oldDepth.set(this.depth);
    this._computeFluxes(deltaSeconds, discharge);
    this._limitOutgoingFluxes(deltaSeconds);
    this._integrateDepth(deltaSeconds);
    this._updateVelocityAndSurface();
    this._updateFoamAndTurbulence(deltaSeconds);
    this.tick += 1;
    this.elapsedSeconds = this.tick * this.config.fixedStepSeconds;
  }

  _internalFlux(previousFlux, firstIndex, secondIndex, deltaSeconds) {
    const firstSurface = this.surface[firstIndex];
    const secondSurface = this.surface[secondIndex];
    const sill = Math.max(this.bed[firstIndex], this.bed[secondIndex]);
    const flowDepth = Math.max(0, Math.max(firstSurface, secondSurface) - sill);
    if (flowDepth <= this.config.dryDepth * 0.2) return 0;

    const gradient = (secondSurface - firstSurface) / this.cellSize;
    let flux = previousFlux - this.config.gravity * flowDepth * deltaSeconds * gradient;
    flux *= Math.exp(-this.config.linearDamping * deltaSeconds);
    if (this.config.manningRoughness > 0) {
      const denominator = 1 + this.config.gravity
        * this.config.manningRoughness * this.config.manningRoughness
        * deltaSeconds * Math.abs(flux)
        / Math.max(1e-6, Math.pow(flowDepth, 7 / 3));
      flux /= denominator;
    }

    const waveSpeed = Math.sqrt(this.config.gravity * flowDepth);
    const faceVelocity = Math.min(
      this.config.maxVelocity,
      this.config.maximumFroude * waveSpeed,
    );
    const maximumFlux = flowDepth * faceVelocity;
    return clamp(flux, -maximumFlux, maximumFlux);
  }

  _computeFluxes(deltaSeconds, discharge) {
    const width = this.width;
    const height = this.height;
    const fluxX = this._fluxX;
    const fluxZ = this._fluxZ;

    for (let gridZ = 0; gridZ < height; ++gridZ) {
      const faceRow = gridZ * (width + 1);
      fluxX[faceRow] = 0;
      fluxX[faceRow + width] = 0;
      for (let faceX = 1; faceX < width; ++faceX) {
        const first = gridZ * width + faceX - 1;
        fluxX[faceRow + faceX] = this._internalFlux(
          fluxX[faceRow + faceX],
          first,
          first + 1,
          deltaSeconds,
        );
      }
    }

    const gateUnitDischarge = this.gate.width > 0 ? discharge / this.gate.width : 0;
    for (let gridX = 0; gridX < width; ++gridX) {
      fluxZ[gridX] = gridX >= this.config.gateStartX && gridX <= this.config.gateEndX
        ? gateUnitDischarge
        : 0;
      for (let faceZ = 1; faceZ < height; ++faceZ) {
        const first = (faceZ - 1) * width + gridX;
        const face = faceZ * width + gridX;
        fluxZ[face] = this._internalFlux(
          fluxZ[face],
          first,
          first + width,
          deltaSeconds,
        );
      }

      const lastIndex = (height - 1) * width + gridX;
      const outFace = height * width + gridX;
      const depth = this.depth[lastIndex];
      if (depth <= this.config.dryDepth) {
        fluxZ[outFace] = 0;
      } else {
        const target = depth * Math.min(
          this.config.maxVelocity,
          this.config.outflowFroude * Math.sqrt(this.config.gravity * depth),
        );
        const response = 1 - Math.exp(-deltaSeconds / this.config.outflowRelaxSeconds);
        fluxZ[outFace] = Math.max(0, fluxZ[outFace] + (target - fluxZ[outFace]) * response);
      }
    }
  }

  _limitOutgoingFluxes(deltaSeconds) {
    const width = this.width;
    const height = this.height;
    const outgoing = this._outgoingRate;
    const scales = this._outgoingScale;
    const fluxX = this._fluxX;
    const fluxZ = this._fluxZ;
    outgoing.fill(0);

    for (let gridZ = 0; gridZ < height; ++gridZ) {
      const faceRow = gridZ * (width + 1);
      for (let faceX = 1; faceX < width; ++faceX) {
        const flux = fluxX[faceRow + faceX];
        const first = gridZ * width + faceX - 1;
        if (flux > 0) outgoing[first] += flux;
        else if (flux < 0) outgoing[first + 1] -= flux;
      }
    }
    for (let faceZ = 1; faceZ < height; ++faceZ) {
      const faceRow = faceZ * width;
      const firstRow = (faceZ - 1) * width;
      for (let gridX = 0; gridX < width; ++gridX) {
        const flux = fluxZ[faceRow + gridX];
        const first = firstRow + gridX;
        if (flux > 0) outgoing[first] += flux;
        else if (flux < 0) outgoing[first + width] -= flux;
      }
    }
    const downstreamFace = height * width;
    const downstreamRow = (height - 1) * width;
    for (let gridX = 0; gridX < width; ++gridX) {
      const flux = fluxZ[downstreamFace + gridX];
      if (flux > 0) outgoing[downstreamRow + gridX] += flux;
    }

    for (let index = 0; index < outgoing.length; ++index) {
      const removableRate = this.depth[index] * this.cellSize * 0.999999 / deltaSeconds;
      scales[index] = outgoing[index] > removableRate && outgoing[index] > 0
        ? removableRate / outgoing[index]
        : 1;
    }

    for (let gridZ = 0; gridZ < height; ++gridZ) {
      const faceRow = gridZ * (width + 1);
      for (let faceX = 1; faceX < width; ++faceX) {
        const face = faceRow + faceX;
        const flux = fluxX[face];
        const first = gridZ * width + faceX - 1;
        if (flux > 0) fluxX[face] *= scales[first];
        else if (flux < 0) fluxX[face] *= scales[first + 1];
      }
    }
    for (let faceZ = 1; faceZ < height; ++faceZ) {
      const faceRow = faceZ * width;
      const firstRow = (faceZ - 1) * width;
      for (let gridX = 0; gridX < width; ++gridX) {
        const face = faceRow + gridX;
        const flux = fluxZ[face];
        const first = firstRow + gridX;
        if (flux > 0) fluxZ[face] *= scales[first];
        else if (flux < 0) fluxZ[face] *= scales[first + width];
      }
    }
    for (let gridX = 0; gridX < width; ++gridX) {
      fluxZ[downstreamFace + gridX] *= scales[downstreamRow + gridX];
    }
  }

  _integrateDepth(deltaSeconds) {
    const width = this.width;
    const height = this.height;
    const factor = deltaSeconds / this.cellSize;
    const cellArea = this.cellSize * this.cellSize;
    let injectedUnitFlux = 0;
    let outflowUnitFlux = 0;
    this._newlyWetCells = 0;

    for (let gridX = 0; gridX < width; ++gridX) {
      injectedUnitFlux += this._fluxZ[gridX];
      outflowUnitFlux += this._fluxZ[height * width + gridX];
    }

    for (let gridZ = 0; gridZ < height; ++gridZ) {
      const xFaceRow = gridZ * (width + 1);
      const northFaceRow = gridZ * width;
      const southFaceRow = (gridZ + 1) * width;
      for (let gridX = 0; gridX < width; ++gridX) {
        const index = gridZ * width + gridX;
        const divergence = this._fluxX[xFaceRow + gridX]
          - this._fluxX[xFaceRow + gridX + 1]
          + this._fluxZ[northFaceRow + gridX]
          - this._fluxZ[southFaceRow + gridX];
        let nextDepth = this.depth[index] + divergence * factor;
        if (nextDepth < 0 && nextDepth > -1e-8) nextDepth = 0;
        nextDepth = Math.max(0, nextDepth);
        if (nextDepth > this.config.maxDepth) {
          this._overflowVolume += (nextDepth - this.config.maxDepth) * cellArea;
          nextDepth = this.config.maxDepth;
        }
        const wasWet = this.wetMask[index] !== 0;
        const isWet = nextDepth >= this.config.wetDepth;
        this.depth[index] = nextDepth;
        this.wetMask[index] = isWet ? 1 : 0;
        if (isWet) {
          this.wetAge[index] = wasWet ? this.wetAge[index] + deltaSeconds : deltaSeconds;
          if (!wasWet) this._newlyWetCells += 1;
          this.everWetMask[index] = 1;
        } else {
          this.wetAge[index] = 0;
        }
      }
    }

    this._injectedVolume += injectedUnitFlux * this.cellSize * deltaSeconds;
    this._outflowVolume += outflowUnitFlux * this.cellSize * deltaSeconds;
  }

  _updateVelocityAndSurface() {
    const width = this.width;
    const height = this.height;
    for (let gridZ = 0; gridZ < height; ++gridZ) {
      const xFaceRow = gridZ * (width + 1);
      const northFaceRow = gridZ * width;
      const southFaceRow = (gridZ + 1) * width;
      for (let gridX = 0; gridX < width; ++gridX) {
        const index = gridZ * width + gridX;
        const depth = this.depth[index];
        this.surface[index] = this.bed[index] + depth;
        if (depth <= this.config.dryDepth) {
          this.velocityX[index] = 0;
          this.velocityZ[index] = 0;
          this.speed[index] = 0;
          continue;
        }
        const velocityX = (this._fluxX[xFaceRow + gridX]
          + this._fluxX[xFaceRow + gridX + 1]) * 0.5 / depth;
        const velocityZ = (this._fluxZ[northFaceRow + gridX]
          + this._fluxZ[southFaceRow + gridX]) * 0.5 / depth;
        const limitedX = clamp(velocityX, -this.config.maxVelocity, this.config.maxVelocity);
        const limitedZ = clamp(velocityZ, -this.config.maxVelocity, this.config.maxVelocity);
        const magnitude = Math.hypot(limitedX, limitedZ);
        if (magnitude > this.config.maxVelocity) {
          const scale = this.config.maxVelocity / magnitude;
          this.velocityX[index] = limitedX * scale;
          this.velocityZ[index] = limitedZ * scale;
          this.speed[index] = this.config.maxVelocity;
        } else {
          this.velocityX[index] = limitedX;
          this.velocityZ[index] = limitedZ;
          this.speed[index] = magnitude;
        }
      }
    }
  }

  _updateFoamAndTurbulence(deltaSeconds) {
    const width = this.width;
    const height = this.height;
    const foamBuild = 1 - Math.exp(-deltaSeconds / this.config.foamBuildSeconds);
    const foamDecay = Math.exp(-deltaSeconds / this.config.foamDecaySeconds);
    const turbulenceResponse = 1
      - Math.exp(-deltaSeconds / this.config.turbulenceResponseSeconds);

    for (let gridZ = 0; gridZ < height; ++gridZ) {
      for (let gridX = 0; gridX < width; ++gridX) {
        const index = gridZ * width + gridX;
        const depth = this.depth[index];
        if (depth <= this.config.dryDepth) {
          this.foam[index] *= foamDecay;
          this.turbulence[index] += (0 - this.turbulence[index]) * turbulenceResponse;
          continue;
        }

        const west = index - (gridX > 0 ? 1 : 0);
        const east = index + (gridX + 1 < width ? 1 : 0);
        const north = index - (gridZ > 0 ? width : 0);
        const south = index + (gridZ + 1 < height ? width : 0);
        const surfaceSlopeX = (this.surface[east] - this.surface[west])
          / Math.max(this.cellSize, (east === west ? 1 : 2) * this.cellSize);
        const surfaceSlopeZ = (this.surface[south] - this.surface[north])
          / Math.max(this.cellSize, (south === north ? 1 : 2) * this.cellSize);
        const surfaceSlope = Math.hypot(surfaceSlopeX, surfaceSlopeZ);
        const shear = (
          Math.abs(this.velocityX[east] - this.velocityX[west])
          + Math.abs(this.velocityZ[south] - this.velocityZ[north])
        ) / Math.max(1, this.config.maxVelocity * 2);
        const depthGain = Math.max(0, (depth - this._oldDepth[index]) / deltaSeconds);
        const froude = this.speed[index]
          / Math.max(0.15, Math.sqrt(this.config.gravity * depth));
        const shallowFront = clamp(
          (depth - this.config.dryDepth) / Math.max(this.config.wetDepth * 5, 1e-5),
        );
        const turbulenceTarget = clamp(
          Math.max(0, froude - 0.18) * 0.48
          + surfaceSlope * 1.35
          + shear * 0.72
          + Math.min(1, depthGain * 0.11),
        );
        this.turbulence[index] += (turbulenceTarget - this.turbulence[index])
          * turbulenceResponse;

        const foamTarget = clamp(
          (Math.max(0, froude - 0.42) * 0.52
            + surfaceSlope * 0.78
            + shear * 0.58
            + Math.min(1, depthGain * 0.075))
          * (0.35 + shallowFront * 0.65),
        );
        this.foam[index] = clamp(Math.max(
          this.foam[index] * foamDecay,
          this.foam[index] + (foamTarget - this.foam[index]) * foamBuild,
        ));
      }
    }
  }

  /** Restore initial water while preserving arrays and cell-view identities. */
  reset() {
    this.elapsedSeconds = 0;
    this.tick = 0;
    this.pendingSeconds = 0;
    this.depth.set(this._initialDepth);
    this.velocityX.set(this._initialVelocityX);
    this.velocityZ.set(this._initialVelocityZ);
    this.foam.fill(0);
    this.turbulence.fill(0);
    this.wetAge.fill(0);
    this.wetMask.fill(0);
    this.everWetMask.fill(0);
    this._fluxX.fill(0);
    this._fluxZ.fill(0);
    this._oldDepth.fill(0);
    this._outgoingRate.fill(0);
    this._outgoingScale.fill(0);
    for (let index = 0; index < this.depth.length; ++index) {
      const depth = this.depth[index];
      this.surface[index] = this.bed[index] + depth;
      const magnitude = Math.hypot(this.velocityX[index], this.velocityZ[index]);
      this.speed[index] = Math.min(this.config.maxVelocity, magnitude);
      const wet = depth >= this.config.wetDepth;
      this.wetMask[index] = wet ? 1 : 0;
      this.everWetMask[index] = wet ? 1 : 0;
    }
    this._injectedVolume = 0;
    this._outflowVolume = 0;
    this._overflowVolume = 0;
    this._newlyWetCells = 0;
    return this;
  }

  /** Bilinear sampling in grid coordinates, where integer coordinates are centres. */
  sampleGrid(gridX, gridZ, target = {}) {
    const x = Number(gridX);
    const z = Number(gridZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    if (x < -0.5 || z < -0.5 || x > this.width - 0.5 || z > this.height - 0.5) return null;
    const sampleX = clamp(x, 0, this.width - 1);
    const sampleZ = clamp(z, 0, this.height - 1);
    const x0 = Math.floor(sampleX);
    const z0 = Math.floor(sampleZ);
    const x1 = Math.min(this.width - 1, x0 + 1);
    const z1 = Math.min(this.height - 1, z0 + 1);
    const tx = sampleX - x0;
    const tz = sampleZ - z0;
    const i00 = z0 * this.width + x0;
    const i10 = z0 * this.width + x1;
    const i01 = z1 * this.width + x0;
    const i11 = z1 * this.width + x1;
    const interpolate = array => {
      const north = array[i00] + (array[i10] - array[i00]) * tx;
      const south = array[i01] + (array[i11] - array[i01]) * tx;
      return north + (south - north) * tz;
    };
    target.gridX = x;
    target.gridZ = z;
    target.x = this.originX + (x + 0.5) * this.cellSize;
    target.z = this.originZ + (z + 0.5) * this.cellSize;
    target.bed = interpolate(this.bed);
    target.depth = interpolate(this.depth);
    target.surface = interpolate(this.surface);
    target.velocityX = interpolate(this.velocityX);
    target.velocityZ = interpolate(this.velocityZ);
    target.speed = Math.hypot(target.velocityX, target.velocityZ);
    target.foam = clamp(interpolate(this.foam));
    target.turbulence = clamp(interpolate(this.turbulence));
    target.wet = target.depth >= this.config.wetDepth;
    return target;
  }

  /** Bilinear world-space sample, or null outside the simulated rectangle. */
  sample(x, z, target = {}) {
    const worldX = Number(x);
    const worldZ = Number(z);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
    const bounds = this.worldBounds;
    if (worldX < bounds.minX || worldX > bounds.maxX
      || worldZ < bounds.minZ || worldZ > bounds.maxZ) return null;
    const gridX = (worldX - this.originX) / this.cellSize - 0.5;
    const gridZ = (worldZ - this.originZ) / this.cellSize - 0.5;
    const result = this.sampleGrid(gridX, gridZ, target);
    if (result) {
      result.x = worldX;
      result.z = worldZ;
    }
    return result;
  }

  _sumVolume() {
    let sum = 0;
    for (const depth of this.depth) sum += depth;
    return sum * this.cellSize * this.cellSize;
  }

  stats() {
    let wetCells = 0;
    let everWetCells = 0;
    let maxDepth = 0;
    let maxSpeed = 0;
    let maxFoam = 0;
    let meanFoam = 0;
    let meanTurbulence = 0;
    let frontGridZ = -1;
    let depthSum = 0;
    for (let index = 0; index < this.depth.length; ++index) {
      const depth = this.depth[index];
      depthSum += depth;
      maxDepth = Math.max(maxDepth, depth);
      maxSpeed = Math.max(maxSpeed, this.speed[index]);
      maxFoam = Math.max(maxFoam, this.foam[index]);
      meanFoam += this.foam[index];
      meanTurbulence += this.turbulence[index];
      if (this.wetMask[index]) {
        wetCells += 1;
        frontGridZ = Math.max(frontGridZ, Math.floor(index / this.width));
      }
      if (this.everWetMask[index]) everWetCells += 1;
    }
    const waterVolume = depthSum * this.cellSize * this.cellSize;
    const accountedVolume = this._initialVolume + this._injectedVolume
      - this._outflowVolume - this._overflowVolume;
    return Object.freeze({
      elapsedSeconds: this.elapsedSeconds,
      tick: this.tick,
      pendingSeconds: this.pendingSeconds,
      cellCount: this.depth.length,
      wetCells,
      newlyWetCells: this._newlyWetCells,
      everWetCells,
      wetFraction: wetCells / this.depth.length,
      everWetFraction: everWetCells / this.depth.length,
      frontGridZ,
      frontZ: frontGridZ >= 0
        ? this.originZ + (frontGridZ + 0.5) * this.cellSize
        : null,
      maxDepth,
      maxSpeed,
      maxFoam,
      meanFoam: meanFoam / this.depth.length,
      meanTurbulence: meanTurbulence / this.depth.length,
      waterVolume,
      initialVolume: this._initialVolume,
      injectedVolume: this._injectedVolume,
      outflowVolume: this._outflowVolume,
      overflowVolume: this._overflowVolume,
      massError: waterVolume - accountedVolume,
      gateOpening: this.gateOpeningAt(),
      gateDischarge: this.gateDischargeAt(),
    });
  }

  snapshot() {
    return {
      version: 1,
      width: this.width,
      height: this.height,
      cellSize: this.cellSize,
      originX: this.originX,
      originZ: this.originZ,
      elapsedSeconds: this.elapsedSeconds,
      tick: this.tick,
      pendingSeconds: this.pendingSeconds,
      gate: { ...this.gate },
      depth: Array.from(this.depth),
      velocityX: Array.from(this.velocityX),
      velocityZ: Array.from(this.velocityZ),
      foam: Array.from(this.foam),
      turbulence: Array.from(this.turbulence),
      wetMask: Array.from(this.wetMask),
      everWetMask: Array.from(this.everWetMask),
      stats: { ...this.stats() },
    };
  }

  validate() {
    const tolerance = 1e-7;
    for (let index = 0; index < this.depth.length; ++index) {
      for (const [name, array] of [
        ["bed", this.bed],
        ["depth", this.depth],
        ["surface", this.surface],
        ["velocityX", this.velocityX],
        ["velocityZ", this.velocityZ],
        ["speed", this.speed],
        ["foam", this.foam],
        ["turbulence", this.turbulence],
      ]) {
        if (!Number.isFinite(array[index])) throw new Error(`${name} is non-finite at cell ${index}`);
      }
      if (this.depth[index] < -tolerance || this.depth[index] > this.config.maxDepth + tolerance) {
        throw new Error(`depth escaped its bounds at cell ${index}`);
      }
      if (Math.abs(this.velocityX[index]) > this.config.maxVelocity + tolerance
        || Math.abs(this.velocityZ[index]) > this.config.maxVelocity + tolerance
        || this.speed[index] > this.config.maxVelocity + tolerance) {
        throw new Error(`velocity escaped its bounds at cell ${index}`);
      }
      if (this.foam[index] < -tolerance || this.foam[index] > 1 + tolerance
        || this.turbulence[index] < -tolerance || this.turbulence[index] > 1 + tolerance) {
        throw new Error(`surface metric escaped [0, 1] at cell ${index}`);
      }
      if (Math.abs(this.surface[index] - this.bed[index] - this.depth[index]) > tolerance) {
        throw new Error(`surface does not match bed plus depth at cell ${index}`);
      }
    }
    return true;
  }
}

export const ShallowWaterModel = FlashFloodModel;
export default FlashFloodModel;
