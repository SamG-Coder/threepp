export const MERCURY_DENSITY_KG_M3 = 13_546;
export const MERCURY_SURFACE_TENSION_N_M = 0.485;
export const STANDARD_GRAVITY_M_S2 = 9.81;

const DEFAULTS = Object.freeze({
  width: 88,
  height: 104,
  poolWidth: 4.4,
  poolDepth: 5.2,
  meanDepth: 0.11,
  bottomHeight: 0,
  fixedStepSeconds: 1 / 240,
  density: MERCURY_DENSITY_KG_M3,
  surfaceTension: MERCURY_SURFACE_TENSION_N_M,
  gravity: STANDARD_GRAVITY_M_S2,
  minimumDepth: 0.008,
  maximumVelocity: 1.6,
  linearDamping: 0.20,
  kinematicViscosity: 0.0009,
  maximumTiltDegrees: 2.5,
  pointerDeadzone: 0.025,
  tiltNaturalFrequency: 3.35,
  tiltDampingRatio: 0.86,
  tiltInertiaScale: 1,
});

const EPSILON = 1e-12;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback, name) {
  const number = finite(value, fallback);
  if (!(number > 0)) throw new RangeError(`${name} must be greater than zero.`);
  return number;
}

function positiveInteger(value, fallback, name) {
  const number = Math.trunc(finite(value, fallback));
  if (number < 4) throw new RangeError(`${name} must be an integer of at least four.`);
  return number;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothUnit(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function bilinear(array, width, x0, x1, z0, z1, tx, tz) {
  const a = array[z0 * width + x0];
  const b = array[z0 * width + x1];
  const c = array[z1 * width + x0];
  const d = array[z1 * width + x1];
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/**
 * Deterministic, renderer-independent shallow mercury pool.
 *
 * x spans poolWidth and z spans poolDepth. `depth` stores the liquid-column
 * depth while `surface` stores absolute model-space elevation
 * (`bottomHeight + depth`). All public typed-array references remain stable
 * for the lifetime of the model, including across reset().
 */
export class MercuryPoolModel {
  constructor(options = {}) {
    this.width = positiveInteger(options.width, DEFAULTS.width, "width");
    this.height = positiveInteger(options.height, DEFAULTS.height, "height");
    this.poolWidth = positive(options.poolWidth, DEFAULTS.poolWidth, "poolWidth");
    this.poolDepth = positive(options.poolDepth, DEFAULTS.poolDepth, "poolDepth");
    this.meanDepth = positive(options.meanDepth, DEFAULTS.meanDepth, "meanDepth");
    this.bottomHeight = finite(options.bottomHeight, DEFAULTS.bottomHeight);
    this.fixedStepSeconds = positive(
      options.fixedStepSeconds,
      DEFAULTS.fixedStepSeconds,
      "fixedStepSeconds",
    );
    this.density = positive(options.density, DEFAULTS.density, "density");
    this.surfaceTension = Math.max(
      0,
      finite(options.surfaceTension, DEFAULTS.surfaceTension),
    );
    this.gravity = positive(options.gravity, DEFAULTS.gravity, "gravity");
    this.minimumDepth = positive(
      options.minimumDepth,
      DEFAULTS.minimumDepth,
      "minimumDepth",
    );
    if (this.minimumDepth >= this.meanDepth) {
      throw new RangeError("minimumDepth must be less than meanDepth.");
    }
    this.maximumVelocity = positive(
      options.maximumVelocity,
      DEFAULTS.maximumVelocity,
      "maximumVelocity",
    );
    this.linearDamping = Math.max(
      0,
      finite(options.linearDamping, DEFAULTS.linearDamping),
    );
    this.kinematicViscosity = Math.max(
      0,
      finite(options.kinematicViscosity, DEFAULTS.kinematicViscosity),
    );
    this.maximumTiltRadians = positive(
      options.maximumTiltDegrees,
      DEFAULTS.maximumTiltDegrees,
      "maximumTiltDegrees",
    ) * Math.PI / 180;
    this.pointerDeadzone = clamp(
      finite(options.pointerDeadzone, DEFAULTS.pointerDeadzone),
      0,
      0.8,
    );

    this.cellSizeX = this.poolWidth / this.width;
    this.cellSizeZ = this.poolDepth / this.height;
    this.originX = finite(options.originX, -this.poolWidth * 0.5);
    this.originZ = finite(options.originZ, -this.poolDepth * 0.5);
    this.worldBounds = Object.freeze({
      minX: this.originX,
      maxX: this.originX + this.poolWidth,
      minZ: this.originZ,
      maxZ: this.originZ + this.poolDepth,
    });

    this.cellCount = this.width * this.height;
    this.cellArea = this.cellSizeX * this.cellSizeZ;
    this.restVolume = this.poolWidth * this.poolDepth * this.meanDepth;
    this.massKg = this.restVolume * this.density;
    const inertiaScale = positive(
      options.tiltInertiaScale,
      DEFAULTS.tiltInertiaScale,
      "tiltInertiaScale",
    );
    this.tiltInertia = positive(
      options.tiltInertia,
      this.massKg * (
        this.poolWidth * this.poolWidth + this.poolDepth * this.poolDepth
      ) / 12 * inertiaScale,
      "tiltInertia",
    );
    const naturalFrequency = positive(
      options.tiltNaturalFrequency,
      DEFAULTS.tiltNaturalFrequency,
      "tiltNaturalFrequency",
    );
    const dampingRatio = Math.max(
      0,
      finite(options.tiltDampingRatio, DEFAULTS.tiltDampingRatio),
    );
    this.tiltStiffness = positive(
      options.tiltStiffness,
      this.tiltInertia * naturalFrequency * naturalFrequency,
      "tiltStiffness",
    );
    this.tiltDamping = Math.max(
      0,
      finite(
        options.tiltDamping,
        2 * dampingRatio * Math.sqrt(this.tiltStiffness * this.tiltInertia),
      ),
    );
    this.tiltNaturalFrequency = Math.sqrt(this.tiltStiffness / this.tiltInertia);
    this.tiltDampingRatio = this.tiltDamping /
      (2 * Math.sqrt(this.tiltStiffness * this.tiltInertia));
    this.capillaryCoefficient = this.surfaceTension / this.density;

    const count = this.cellCount;
    const xFaceCount = (this.width + 1) * this.height;
    const zFaceCount = this.width * (this.height + 1);
    this.depth = new Float64Array(count);
    this.surface = new Float64Array(count);
    this.velocityX = new Float64Array(count);
    this.velocityZ = new Float64Array(count);
    this.curvature = new Float64Array(count);
    this.agitation = new Float64Array(count);
    this.faceVelocityX = new Float64Array(xFaceCount);
    this.faceVelocityZ = new Float64Array(zFaceCount);

    this.pointer = new Float64Array(2);
    this.pointerWeight = 1;
    this.targetTilt = new Float64Array(2);
    this.tilt = new Float64Array(2);
    this.tiltVelocity = new Float64Array(2);
    this.apparentGravity = new Float64Array(3);

    this._pressure = new Float64Array(count);
    this._nextDepth = new Float64Array(count);
    this._nextFaceVelocityX = new Float64Array(xFaceCount);
    this._nextFaceVelocityZ = new Float64Array(zFaceCount);
    this._fluxX = new Float64Array(xFaceCount);
    this._fluxZ = new Float64Array(zFaceCount);
    this._donorScale = new Float64Array(count);
    this._targetDepthSum = this.meanDepth * count;
    this._events = [];
    this._eventSequence = 0;
    this._accumulator = 0;
    this._lastAdvanceSteps = 0;
    this.tick = 0;
    this.elapsedSeconds = 0;

    this.config = Object.freeze({
      width: this.width,
      height: this.height,
      poolWidth: this.poolWidth,
      poolDepth: this.poolDepth,
      meanDepth: this.meanDepth,
      bottomHeight: this.bottomHeight,
      originX: this.originX,
      originZ: this.originZ,
      fixedStepSeconds: this.fixedStepSeconds,
      density: this.density,
      surfaceTension: this.surfaceTension,
      gravity: this.gravity,
      minimumDepth: this.minimumDepth,
      maximumVelocity: this.maximumVelocity,
      linearDamping: this.linearDamping,
      kinematicViscosity: this.kinematicViscosity,
      maximumTiltDegrees: this.maximumTiltRadians * 180 / Math.PI,
      pointerDeadzone: this.pointerDeadzone,
      tiltInertia: this.tiltInertia,
      tiltStiffness: this.tiltStiffness,
      tiltDamping: this.tiltDamping,
      tiltNaturalFrequency: this.tiltNaturalFrequency,
      tiltDampingRatio: this.tiltDampingRatio,
    });

    this.reset();
  }

  get time() {
    return this.elapsedSeconds;
  }

  _updateTargetTilt() {
    const x = this.pointer[0];
    const y = this.pointer[1];
    const radius = Math.hypot(x, y);
    if (radius <= this.pointerDeadzone + EPSILON) {
      this.targetTilt[0] = 0;
      this.targetTilt[1] = 0;
      return;
    }
    const normalized = (radius - this.pointerDeadzone) /
      Math.max(EPSILON, 1 - this.pointerDeadzone);
    const response = Math.min(1, smoothUnit(normalized) * this.pointerWeight);
    const scale = this.maximumTiltRadians * response / radius;
    this.targetTilt[0] = x * scale;
    // Screen y increases downward while world z increases into the room.
    this.targetTilt[1] = -y * scale;
  }

  setPointer(normalizedX = 0, normalizedY = 0, options = null) {
    this.pointer[0] = clamp(finite(normalizedX, 0), -1, 1);
    this.pointer[1] = clamp(finite(normalizedY, 0), -1, 1);
    const requestedWeight = typeof options === "number" ? options : options?.weight;
    this.pointerWeight = clamp(finite(requestedWeight, 1), 0, 2);
    this._updateTargetTilt();
    return this;
  }

  _enqueue(event) {
    this._events.push(event);
    this._events.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    return this;
  }

  queuePointer(tick, normalizedX = 0, normalizedY = 0, options = null) {
    const scheduledTick = Math.max(this.tick, Math.trunc(finite(tick, this.tick)));
    const requestedWeight = typeof options === "number" ? options : options?.weight;
    return this._enqueue({
      type: "pointer",
      tick: scheduledTick,
      sequence: this._eventSequence++,
      x: clamp(finite(normalizedX, 0), -1, 1),
      y: clamp(finite(normalizedY, 0), -1, 1),
      weight: clamp(finite(requestedWeight, 1), 0, 2),
    });
  }

  disturb(
    worldX = this.originX + this.poolWidth * 0.5,
    worldZ = this.originZ + this.poolDepth * 0.5,
    amplitude = 0.025,
    radius = 0.28,
    atTick = this.tick,
  ) {
    const event = {
      type: "disturbance",
      tick: Math.max(this.tick, Math.trunc(finite(atTick, this.tick))),
      sequence: this._eventSequence++,
      x: finite(worldX, this.originX + this.poolWidth * 0.5),
      z: finite(worldZ, this.originZ + this.poolDepth * 0.5),
      amplitude: clamp(
        finite(amplitude, 0.025),
        -(this.meanDepth - this.minimumDepth) * 0.65,
        this.meanDepth * 0.65,
      ),
      radius: Math.max(
        Math.min(this.cellSizeX, this.cellSizeZ) * 1.5,
        positive(radius, 0.28, "disturbance radius"),
      ),
    };
    if (event.tick > this.tick) return this._enqueue(event);
    this._applyDisturbance(event);
    this._refreshDerivedFields();
    return this;
  }

  _applyDisturbance(event) {
    const radiusSquared = event.radius * event.radius;
    let addedDepth = 0;
    for (let z = 0; z < this.height; ++z) {
      const worldZ = this.originZ + (z + 0.5) * this.cellSizeZ;
      for (let x = 0; x < this.width; ++x) {
        const worldX = this.originX + (x + 0.5) * this.cellSizeX;
        const distanceSquared = (worldX - event.x) * (worldX - event.x) +
          (worldZ - event.z) * (worldZ - event.z);
        if (distanceSquared >= radiusSquared) continue;
        const t = Math.sqrt(distanceSquared / radiusSquared);
        const cosine = 0.5 + 0.5 * Math.cos(Math.PI * t);
        const delta = event.amplitude * cosine * cosine;
        this.depth[z * this.width + x] += delta;
        addedDepth += delta;
      }
    }
    const compensation = addedDepth / this.cellCount;
    for (let index = 0; index < this.cellCount; ++index) {
      this.depth[index] -= compensation;
    }
    this._projectDepthToVolume();
  }

  _applyScheduledEvents() {
    let count = 0;
    while (count < this._events.length && this._events[count].tick <= this.tick) {
      const event = this._events[count++];
      if (event.type === "pointer") this.setPointer(event.x, event.y, event.weight);
      else if (event.type === "disturbance") this._applyDisturbance(event);
    }
    if (count > 0) this._events.splice(0, count);
  }

  _stepTilt(dt) {
    const inverseInertia = 1 / this.tiltInertia;
    for (let axis = 0; axis < 2; ++axis) {
      const acceleration = (
        this.tiltStiffness * (this.targetTilt[axis] - this.tilt[axis]) -
        this.tiltDamping * this.tiltVelocity[axis]
      ) * inverseInertia;
      this.tiltVelocity[axis] += acceleration * dt;
      this.tilt[axis] += this.tiltVelocity[axis] * dt;
    }
    const tiltLength = Math.hypot(this.tilt[0], this.tilt[1]);
    if (tiltLength > this.maximumTiltRadians) {
      const nx = this.tilt[0] / tiltLength;
      const nz = this.tilt[1] / tiltLength;
      this.tilt[0] = nx * this.maximumTiltRadians;
      this.tilt[1] = nz * this.maximumTiltRadians;
      const outwardSpeed = this.tiltVelocity[0] * nx + this.tiltVelocity[1] * nz;
      if (outwardSpeed > 0) {
        this.tiltVelocity[0] -= nx * outwardSpeed;
        this.tiltVelocity[1] -= nz * outwardSpeed;
      }
    }
    this.apparentGravity[0] = this.gravity * Math.tan(this.tilt[0]);
    this.apparentGravity[1] = -this.gravity;
    this.apparentGravity[2] = this.gravity * Math.tan(this.tilt[1]);
  }

  _computePressure() {
    const width = this.width;
    const height = this.height;
    const inverseDxSquared = 1 / (this.cellSizeX * this.cellSizeX);
    const inverseDzSquared = 1 / (this.cellSizeZ * this.cellSizeZ);
    for (let z = 0; z < height; ++z) {
      const beforeZ = Math.max(0, z - 1);
      const afterZ = Math.min(height - 1, z + 1);
      for (let x = 0; x < width; ++x) {
        const beforeX = Math.max(0, x - 1);
        const afterX = Math.min(width - 1, x + 1);
        const index = z * width + x;
        const center = this.depth[index] - this.meanDepth;
        const laplacian = (
          this.depth[z * width + beforeX] - this.meanDepth - 2 * center +
          this.depth[z * width + afterX] - this.meanDepth
        ) * inverseDxSquared + (
          this.depth[beforeZ * width + x] - this.meanDepth - 2 * center +
          this.depth[afterZ * width + x] - this.meanDepth
        ) * inverseDzSquared;
        this.curvature[index] = laplacian;
        this._pressure[index] = this.gravity * center -
          this.capillaryCoefficient * laplacian;
      }
    }
  }

  _updateFaceVelocities(dt) {
    const width = this.width;
    const height = this.height;
    const strideX = width + 1;
    const inverseDx = 1 / this.cellSizeX;
    const inverseDz = 1 / this.cellSizeZ;
    const inverseDxSquared = inverseDx * inverseDx;
    const inverseDzSquared = inverseDz * inverseDz;
    const damping = Math.exp(-this.linearDamping * dt);
    const viscosity = this.kinematicViscosity;
    const maximumVelocity = this.maximumVelocity;
    const oldX = this.faceVelocityX;
    const oldZ = this.faceVelocityZ;
    const nextX = this._nextFaceVelocityX;
    const nextZ = this._nextFaceVelocityZ;
    nextX.fill(0);
    nextZ.fill(0);

    for (let z = 0; z < height; ++z) {
      const row = z * strideX;
      for (let x = 1; x < width; ++x) {
        const index = row + x;
        const value = oldX[index];
        const beforeZ = z > 0 ? oldX[index - strideX] : value;
        const afterZ = z + 1 < height ? oldX[index + strideX] : value;
        const laplacian = (oldX[index - 1] - 2 * value + oldX[index + 1]) *
          inverseDxSquared + (beforeZ - 2 * value + afterZ) * inverseDzSquared;
        const pressureGradient = (
          this._pressure[z * width + x] - this._pressure[z * width + x - 1]
        ) * inverseDx;
        nextX[index] = clamp(
          (value + dt * (
            this.apparentGravity[0] - pressureGradient + viscosity * laplacian
          )) * damping,
          -maximumVelocity,
          maximumVelocity,
        );
      }
    }

    for (let z = 1; z < height; ++z) {
      const row = z * width;
      for (let x = 0; x < width; ++x) {
        const index = row + x;
        const value = oldZ[index];
        const beforeX = x > 0 ? oldZ[index - 1] : value;
        const afterX = x + 1 < width ? oldZ[index + 1] : value;
        const laplacian = (beforeX - 2 * value + afterX) * inverseDxSquared +
          (oldZ[index - width] - 2 * value + oldZ[index + width]) *
          inverseDzSquared;
        const pressureGradient = (
          this._pressure[z * width + x] - this._pressure[(z - 1) * width + x]
        ) * inverseDz;
        nextZ[index] = clamp(
          (value + dt * (
            this.apparentGravity[2] - pressureGradient + viscosity * laplacian
          )) * damping,
          -maximumVelocity,
          maximumVelocity,
        );
      }
    }
    oldX.set(nextX);
    oldZ.set(nextZ);
  }

  _computeLimitedFluxes(dt) {
    const width = this.width;
    const height = this.height;
    const strideX = width + 1;
    const fluxX = this._fluxX;
    const fluxZ = this._fluxZ;
    fluxX.fill(0);
    fluxZ.fill(0);

    for (let z = 0; z < height; ++z) {
      const cellRow = z * width;
      const faceRow = z * strideX;
      for (let x = 1; x < width; ++x) {
        fluxX[faceRow + x] = 0.5 * (
          this.depth[cellRow + x - 1] + this.depth[cellRow + x]
        ) * this.faceVelocityX[faceRow + x];
      }
    }
    for (let z = 1; z < height; ++z) {
      const faceRow = z * width;
      const beforeRow = (z - 1) * width;
      const afterRow = z * width;
      for (let x = 0; x < width; ++x) {
        fluxZ[faceRow + x] = 0.5 * (
          this.depth[beforeRow + x] + this.depth[afterRow + x]
        ) * this.faceVelocityZ[faceRow + x];
      }
    }

    const inverseDx = 1 / this.cellSizeX;
    const inverseDz = 1 / this.cellSizeZ;
    for (let z = 0; z < height; ++z) {
      const cellRow = z * width;
      const xFaceRow = z * strideX;
      const zFaceRow = z * width;
      const nextZFaceRow = (z + 1) * width;
      for (let x = 0; x < width; ++x) {
        const index = cellRow + x;
        const left = fluxX[xFaceRow + x];
        const right = fluxX[xFaceRow + x + 1];
        const before = fluxZ[zFaceRow + x];
        const after = fluxZ[nextZFaceRow + x];
        const outgoingRate = (
          Math.max(right, 0) + Math.max(-left, 0)
        ) * inverseDx + (
          Math.max(after, 0) + Math.max(-before, 0)
        ) * inverseDz;
        const available = Math.max(0, this.depth[index] - this.minimumDepth);
        this._donorScale[index] = outgoingRate > EPSILON
          ? Math.min(1, available / (dt * outgoingRate))
          : 1;
      }
    }

    // Each interface remains one shared flux. Selecting its upwind donor's
    // scale preserves both positivity and pairwise conservation.
    for (let z = 0; z < height; ++z) {
      const cellRow = z * width;
      const faceRow = z * strideX;
      for (let x = 1; x < width; ++x) {
        const face = faceRow + x;
        const value = fluxX[face];
        const donor = value >= 0 ? cellRow + x - 1 : cellRow + x;
        fluxX[face] = value * this._donorScale[donor];
      }
    }
    for (let z = 1; z < height; ++z) {
      const faceRow = z * width;
      const beforeRow = (z - 1) * width;
      const afterRow = z * width;
      for (let x = 0; x < width; ++x) {
        const face = faceRow + x;
        const value = fluxZ[face];
        const donor = value >= 0 ? beforeRow + x : afterRow + x;
        fluxZ[face] = value * this._donorScale[donor];
      }
    }
  }

  _updateDepth(dt) {
    const width = this.width;
    const height = this.height;
    const strideX = width + 1;
    const inverseDx = 1 / this.cellSizeX;
    const inverseDz = 1 / this.cellSizeZ;
    for (let z = 0; z < height; ++z) {
      const cellRow = z * width;
      const xFaceRow = z * strideX;
      const zFaceRow = z * width;
      const nextZFaceRow = (z + 1) * width;
      for (let x = 0; x < width; ++x) {
        const index = cellRow + x;
        const divergence = (
          this._fluxX[xFaceRow + x + 1] - this._fluxX[xFaceRow + x]
        ) * inverseDx + (
          this._fluxZ[nextZFaceRow + x] - this._fluxZ[zFaceRow + x]
        ) * inverseDz;
        this._nextDepth[index] = Math.max(
          this.minimumDepth,
          this.depth[index] - dt * divergence,
        );
      }
    }
    this.depth.set(this._nextDepth);
    this._projectDepthToVolume();
  }

  _projectDepthToVolume() {
    let sum = 0;
    for (let index = 0; index < this.cellCount; ++index) {
      let value = this.depth[index];
      if (!Number.isFinite(value)) value = this.meanDepth;
      value = Math.max(this.minimumDepth, value);
      this.depth[index] = value;
      sum += value;
    }
    const difference = this._targetDepthSum - sum;
    // A closed shared-flux update already telescopes to zero. Do not turn its
    // final summation ulps into a uniform surface movement; this also keeps an
    // exactly flat rest state bit-identical for deterministic render caching.
    if (Math.abs(difference) <= 1e-12 * Math.max(1, this._targetDepthSum)) return;
    if (difference >= 0) {
      const addition = difference / this.cellCount;
      for (let index = 0; index < this.cellCount; ++index) {
        this.depth[index] += addition;
      }
    } else {
      let removable = 0;
      for (let index = 0; index < this.cellCount; ++index) {
        removable += this.depth[index] - this.minimumDepth;
      }
      const fraction = removable > EPSILON
        ? Math.min(1, -difference / removable)
        : 0;
      for (let index = 0; index < this.cellCount; ++index) {
        this.depth[index] -= (this.depth[index] - this.minimumDepth) * fraction;
      }
    }
  }

  _refreshDerivedFields() {
    const width = this.width;
    const height = this.height;
    const strideX = width + 1;
    const inverseDx = 1 / this.cellSizeX;
    const inverseDz = 1 / this.cellSizeZ;
    const inverseDxSquared = inverseDx * inverseDx;
    const inverseDzSquared = inverseDz * inverseDz;
    for (let z = 0; z < height; ++z) {
      const beforeZ = Math.max(0, z - 1);
      const afterZ = Math.min(height - 1, z + 1);
      for (let x = 0; x < width; ++x) {
        const beforeX = Math.max(0, x - 1);
        const afterX = Math.min(width - 1, x + 1);
        const index = z * width + x;
        const center = this.depth[index];
        const laplacian = (
          this.depth[z * width + beforeX] - 2 * center +
          this.depth[z * width + afterX]
        ) * inverseDxSquared + (
          this.depth[beforeZ * width + x] - 2 * center +
          this.depth[afterZ * width + x]
        ) * inverseDzSquared;
        const velocityX = 0.5 * (
          this.faceVelocityX[z * strideX + x] +
          this.faceVelocityX[z * strideX + x + 1]
        );
        const velocityZ = 0.5 * (
          this.faceVelocityZ[z * width + x] +
          this.faceVelocityZ[(z + 1) * width + x]
        );
        const divergence = (
          this.faceVelocityX[z * strideX + x + 1] -
          this.faceVelocityX[z * strideX + x]
        ) * inverseDx + (
          this.faceVelocityZ[(z + 1) * width + x] -
          this.faceVelocityZ[z * width + x]
        ) * inverseDz;
        this.surface[index] = this.bottomHeight + center;
        this.velocityX[index] = velocityX;
        this.velocityZ[index] = velocityZ;
        this.curvature[index] = laplacian;
        this.agitation[index] = clamp(
          Math.hypot(velocityX, velocityZ) / 0.8 * 0.55 +
          Math.abs(laplacian) * 0.025 + Math.abs(divergence) * 0.035,
          0,
          1,
        );
      }
    }
  }

  _step() {
    const dt = this.fixedStepSeconds;
    this._applyScheduledEvents();
    this._stepTilt(dt);
    this._computePressure();
    this._updateFaceVelocities(dt);
    this._computeLimitedFluxes(dt);
    this._updateDepth(dt);
    this.tick += 1;
    this.elapsedSeconds = this.tick * dt;
  }

  advanceTicks(count = 1) {
    const steps = Math.trunc(finite(count, 0));
    if (steps < 0) throw new RangeError("advanceTicks count cannot be negative.");
    for (let step = 0; step < steps; ++step) this._step();
    if (steps > 0) this._refreshDerivedFields();
    this._lastAdvanceSteps = steps;
    return this.stats();
  }

  advance(seconds = 0) {
    const delta = finite(seconds, 0);
    if (delta < 0) throw new RangeError("advance seconds cannot be negative.");
    const total = this._accumulator + delta;
    let steps = Math.floor(total / this.fixedStepSeconds + 1e-10);
    let remainder = total - steps * this.fixedStepSeconds;
    if (remainder < 0 && remainder > -this.fixedStepSeconds * 1e-7) remainder = 0;
    if (remainder < 0) {
      steps -= 1;
      remainder += this.fixedStepSeconds;
    }
    if (steps > 10_000_000) {
      throw new RangeError("advance request is too large for one deterministic call.");
    }
    this._accumulator = remainder;
    for (let step = 0; step < steps; ++step) this._step();
    if (steps > 0) this._refreshDerivedFields();
    this._lastAdvanceSteps = steps;
    return this.stats();
  }

  sample(worldX, worldZ, out = {}) {
    const x = finite(worldX, this.originX + this.poolWidth * 0.5);
    const z = finite(worldZ, this.originZ + this.poolDepth * 0.5);
    const inside = x >= this.worldBounds.minX && x <= this.worldBounds.maxX &&
      z >= this.worldBounds.minZ && z <= this.worldBounds.maxZ;
    const gridX = clamp((x - this.originX) / this.cellSizeX - 0.5, 0, this.width - 1);
    const gridZ = clamp((z - this.originZ) / this.cellSizeZ - 0.5, 0, this.height - 1);
    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);
    const x1 = Math.min(this.width - 1, x0 + 1);
    const z1 = Math.min(this.height - 1, z0 + 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    out.inside = inside;
    out.gridX = gridX;
    out.gridZ = gridZ;
    out.depth = bilinear(this.depth, this.width, x0, x1, z0, z1, tx, tz);
    out.surface = bilinear(this.surface, this.width, x0, x1, z0, z1, tx, tz);
    out.velocityX = bilinear(this.velocityX, this.width, x0, x1, z0, z1, tx, tz);
    out.velocityZ = bilinear(this.velocityZ, this.width, x0, x1, z0, z1, tx, tz);
    out.curvature = bilinear(this.curvature, this.width, x0, x1, z0, z1, tx, tz);
    out.agitation = bilinear(this.agitation, this.width, x0, x1, z0, z1, tx, tz);
    out.tiltX = this.tilt[0];
    out.tiltZ = this.tilt[1];
    return out;
  }

  stats() {
    let depthSum = 0;
    let minimumDepth = Number.POSITIVE_INFINITY;
    let maximumDepth = 0;
    let maximumSpeed = 0;
    let displacementSquared = 0;
    let centerX = 0;
    let centerZ = 0;
    let energy = 0;
    for (let z = 0; z < this.height; ++z) {
      const worldZ = this.originZ + (z + 0.5) * this.cellSizeZ;
      for (let x = 0; x < this.width; ++x) {
        const index = z * this.width + x;
        const depth = this.depth[index];
        const displacement = depth - this.meanDepth;
        const speedSquared = this.velocityX[index] * this.velocityX[index] +
          this.velocityZ[index] * this.velocityZ[index];
        const speed = Math.sqrt(speedSquared);
        const beforeX = Math.max(0, x - 1);
        const afterX = Math.min(this.width - 1, x + 1);
        const beforeZ = Math.max(0, z - 1);
        const afterZ = Math.min(this.height - 1, z + 1);
        const slopeX = (
          this.depth[z * this.width + afterX] -
          this.depth[z * this.width + beforeX]
        ) / Math.max(this.cellSizeX, (afterX - beforeX) * this.cellSizeX);
        const slopeZ = (
          this.depth[afterZ * this.width + x] -
          this.depth[beforeZ * this.width + x]
        ) / Math.max(this.cellSizeZ, (afterZ - beforeZ) * this.cellSizeZ);
        depthSum += depth;
        minimumDepth = Math.min(minimumDepth, depth);
        maximumDepth = Math.max(maximumDepth, depth);
        maximumSpeed = Math.max(maximumSpeed, speed);
        displacementSquared += displacement * displacement;
        centerX += depth * (this.originX + (x + 0.5) * this.cellSizeX);
        centerZ += depth * worldZ;
        energy += (
          0.5 * this.density * depth * speedSquared +
          0.5 * this.density * this.gravity * displacement * displacement +
          0.5 * this.surfaceTension * (slopeX * slopeX + slopeZ * slopeZ)
        ) * this.cellArea;
      }
    }
    const volume = depthSum * this.cellArea;
    const inverseDepthSum = depthSum > EPSILON ? 1 / depthSum : 0;
    const apparentWeight = this.massKg * Math.hypot(
      this.apparentGravity[0],
      this.apparentGravity[1],
      this.apparentGravity[2],
    );
    return {
      tick: this.tick,
      elapsedSeconds: this.elapsedSeconds,
      lastAdvanceSteps: this._lastAdvanceSteps,
      pendingEvents: this._events.length,
      width: this.width,
      height: this.height,
      cells: this.cellCount,
      poolWidth: this.poolWidth,
      poolDepth: this.poolDepth,
      cellSizeX: this.cellSizeX,
      cellSizeZ: this.cellSizeZ,
      meanDepth: depthSum / this.cellCount,
      minimumDepth,
      maximumDepth,
      maximumSpeed,
      rmsSurfaceDisplacement: Math.sqrt(displacementSquared / this.cellCount),
      volume,
      volumeError: volume - this.restVolume,
      massKg: this.massKg,
      restWeightNewtons: this.massKg * this.gravity,
      apparentWeightNewtons: apparentWeight,
      centerOfMassX: centerX * inverseDepthSum,
      centerOfMassZ: centerZ * inverseDepthSum,
      tiltX: this.tilt[0],
      tiltZ: this.tilt[1],
      targetTiltX: this.targetTilt[0],
      targetTiltZ: this.targetTilt[1],
      tiltSpeed: Math.hypot(this.tiltVelocity[0], this.tiltVelocity[1]),
      apparentAccelerationX: this.apparentGravity[0],
      apparentAccelerationZ: this.apparentGravity[2],
      pointerWeight: this.pointerWeight,
      mechanicalEnergyJoules: energy,
    };
  }

  reset() {
    this.depth.fill(this.meanDepth);
    this.surface.fill(this.bottomHeight + this.meanDepth);
    this.velocityX.fill(0);
    this.velocityZ.fill(0);
    this.curvature.fill(0);
    this.agitation.fill(0);
    this.faceVelocityX.fill(0);
    this.faceVelocityZ.fill(0);
    this._pressure.fill(0);
    this._nextDepth.fill(this.meanDepth);
    this._nextFaceVelocityX.fill(0);
    this._nextFaceVelocityZ.fill(0);
    this._fluxX.fill(0);
    this._fluxZ.fill(0);
    this._donorScale.fill(1);
    this.pointer.fill(0);
    this.pointerWeight = 1;
    this.targetTilt.fill(0);
    this.tilt.fill(0);
    this.tiltVelocity.fill(0);
    this.apparentGravity[0] = 0;
    this.apparentGravity[1] = -this.gravity;
    this.apparentGravity[2] = 0;
    this._events.length = 0;
    this._eventSequence = 0;
    this._accumulator = 0;
    this._lastAdvanceSteps = 0;
    this.tick = 0;
    this.elapsedSeconds = 0;
    this._refreshDerivedFields();
    return this;
  }
}

export const HeavyLiquidPoolModel = MercuryPoolModel;
export const MercuryModel = MercuryPoolModel;
export default MercuryPoolModel;
