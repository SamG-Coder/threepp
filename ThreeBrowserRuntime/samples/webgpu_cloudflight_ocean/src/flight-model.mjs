import * as THREE from "three/webgpu";

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

function damp(current, target, response, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));
}

function layeredTurbulence(time, phase = 0) {
  return (
    Math.sin(time * 0.73 + phase) * 0.52 +
    Math.sin(time * 1.91 + phase * 1.7) * 0.28 +
    Math.sin(time * 4.37 - phase * 0.6) * 0.14 +
    Math.sin(time * 8.21 + phase * 2.3) * 0.06
  );
}

export function createFlightModel(camera) {
  const keys = new Set();
  const state = {
    position: new THREE.Vector3(0, 1_260, 180),
    heading: THREE.MathUtils.degToRad(188),
    pitch: THREE.MathUtils.degToRad(-2.2),
    bank: THREE.MathUtils.degToRad(-4),
    speed: 104,
    throttle: 0.72,
    verticalSpeed: 0,
    gLoad: 1,
    autopilot: true,
    lookYaw: 0,
    lookPitch: 0,
    lookYawTarget: 0,
    lookPitchTarget: 0,
    dragging: false,
    lastPointer: new THREE.Vector2(),
    distance: 0,
  };

  const attitude = new THREE.Euler(0, 0, 0, "YXZ");
  const flightQuaternion = new THREE.Quaternion();
  const lookQuaternion = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const previousPosition = state.position.clone();

  function keyDown(event) {
    const key = String(event.key || "").toLowerCase();
    if (!event.repeat && key === "f") state.autopilot = !state.autopilot;
    keys.add(key);
  }

  function keyUp(event) {
    keys.delete(String(event.key || "").toLowerCase());
  }

  function pointerDown(event) {
    if (event.button !== 0) return;
    state.dragging = true;
    state.lastPointer.set(event.clientX, event.clientY);
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    state.lastPointer.set(event.clientX, event.clientY);
    state.lookYawTarget = THREE.MathUtils.clamp(
      state.lookYawTarget - dx * 0.0028,
      -0.72,
      0.72,
    );
    state.lookPitchTarget = THREE.MathUtils.clamp(
      state.lookPitchTarget - dy * 0.0025,
      -0.38,
      0.32,
    );
  }

  function pointerUp(event) {
    state.dragging = false;
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  }

  function wheel(event) {
    state.throttle = THREE.MathUtils.clamp(
      state.throttle - Math.sign(event.deltaY) * 0.035,
      0.22,
      1,
    );
    event.preventDefault?.();
  }

  function installInput(element) {
    globalThis.addEventListener("keydown", keyDown);
    globalThis.addEventListener("keyup", keyUp);
    element.addEventListener("pointerdown", pointerDown);
    element.addEventListener("pointermove", pointerMove);
    element.addEventListener("pointerup", pointerUp);
    element.addEventListener("pointercancel", pointerUp);
    element.addEventListener("wheel", wheel, { passive: false });
  }

  function removeInput(element) {
    globalThis.removeEventListener("keydown", keyDown);
    globalThis.removeEventListener("keyup", keyUp);
    element.removeEventListener("pointerdown", pointerDown);
    element.removeEventListener("pointermove", pointerMove);
    element.removeEventListener("pointerup", pointerUp);
    element.removeEventListener("pointercancel", pointerUp);
    element.removeEventListener("wheel", wheel);
  }

  function update(time, delta, weather = {}) {
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const storm = THREE.MathUtils.clamp(Number(weather.storm ?? 0.65), 0, 1);
    const cloudImmersion = THREE.MathUtils.clamp(Number(weather.cloudImmersion ?? 0), 0, 1);
    const turbulenceStrength = (0.24 + storm * 0.68) * (0.35 + cloudImmersion * 0.95);

    let targetBank;
    let targetPitch;
    let rudder = 0;
    if (state.autopilot) {
      targetBank = THREE.MathUtils.degToRad(
        Math.sin(time * 0.085) * 11 + Math.sin(time * 0.031 + 1.2) * 5,
      );
      targetPitch = THREE.MathUtils.degToRad(
        -1.5 + Math.sin(time * 0.071 + 0.8) * 2.8,
      );
      rudder = Math.sin(time * 0.047) * 0.055;
    } else {
      const rollInput = (keys.has("arrowright") || keys.has("d") ? 1 : 0)
        - (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
      const pitchInput = (keys.has("arrowup") || keys.has("w") ? 1 : 0)
        - (keys.has("arrowdown") || keys.has("s") ? 1 : 0);
      rudder = (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0);
      targetBank = rollInput * THREE.MathUtils.degToRad(34);
      targetPitch = pitchInput * THREE.MathUtils.degToRad(12);
    }

    const buffetRoll = layeredTurbulence(time, 0.4) * THREE.MathUtils.degToRad(1.35) * turbulenceStrength;
    const buffetPitch = layeredTurbulence(time, 2.1) * THREE.MathUtils.degToRad(0.74) * turbulenceStrength;
    state.bank = damp(state.bank, targetBank + buffetRoll, 2.35, dt);
    state.pitch = damp(state.pitch, targetPitch + buffetPitch, 2.0, dt);

    if (keys.has("+") || keys.has("=")) state.throttle = Math.min(1, state.throttle + dt * 0.24);
    if (keys.has("-") || keys.has("_")) state.throttle = Math.max(0.22, state.throttle - dt * 0.24);
    if (keys.has("shift")) state.throttle = Math.min(1, state.throttle + dt * 0.24);
    if (keys.has("control")) state.throttle = Math.max(0.22, state.throttle - dt * 0.24);
    const targetSpeed = 62 + state.throttle * 76;
    state.speed = damp(state.speed, targetSpeed, 0.62, dt);

    const coordinatedTurn = Math.tan(state.bank) * 9.81 / Math.max(state.speed, 35);
    state.heading += (coordinatedTurn + rudder * 0.18) * dt;
    attitude.set(state.pitch, state.heading, state.bank, "YXZ");
    flightQuaternion.setFromEuler(attitude);
    forward.copy(FORWARD).applyQuaternion(flightQuaternion).normalize();
    right.crossVectors(forward, UP).normalize();

    previousPosition.copy(state.position);
    state.position.addScaledVector(forward, state.speed * dt);
    // Broad vertical air motion gives the weather mass rather than making the
    // camera ride a scripted sine wave independently of the aircraft.
    const updraft = layeredTurbulence(time * 0.43, 4.7) * storm * cloudImmersion * 2.6;
    state.position.y += updraft * dt;
    state.position.y = THREE.MathUtils.clamp(state.position.y, 380, 2_450);
    state.verticalSpeed = (state.position.y - previousPosition.y) / Math.max(dt, 1e-4);
    state.distance += state.position.distanceTo(previousPosition);
    state.gLoad = 1 / Math.max(Math.cos(state.bank), 0.35) + Math.abs(buffetPitch) * 1.6;

    state.lookYaw = damp(state.lookYaw, state.lookYawTarget, 5.8, dt);
    state.lookPitch = damp(state.lookPitch, state.lookPitchTarget, 5.8, dt);
    if (!state.dragging) {
      state.lookYawTarget = damp(state.lookYawTarget, 0, 0.55, dt);
      state.lookPitchTarget = damp(state.lookPitchTarget, 0, 0.55, dt);
    }
    lookQuaternion.setFromEuler(new THREE.Euler(
      state.lookPitch,
      state.lookYaw,
      0,
      "YXZ",
    ));
    camera.position.copy(state.position);
    camera.quaternion.copy(flightQuaternion).multiply(lookQuaternion);

    return {
      ...state,
      forward: forward.clone(),
      right: right.clone(),
      headingDegrees: (THREE.MathUtils.radToDeg(state.heading) % 360 + 360) % 360,
      pitchDegrees: THREE.MathUtils.radToDeg(state.pitch),
      bankDegrees: THREE.MathUtils.radToDeg(state.bank),
      rollDegrees: THREE.MathUtils.radToDeg(state.bank),
      pitchRadians: state.pitch,
      rollRadians: state.bank,
      airspeedMps: state.speed,
      altitudeM: state.position.y,
      verticalSpeedMps: state.verticalSpeed,
      controls: {
        throttle: state.throttle,
        aileron: THREE.MathUtils.clamp(state.bank / THREE.MathUtils.degToRad(34), -1, 1),
        elevator: THREE.MathUtils.clamp(state.pitch / THREE.MathUtils.degToRad(12), -1, 1),
        rudder,
      },
      altitude: state.position.y,
      speedKnots: state.speed * 1.943844,
    };
  }

  return { state, installInput, removeInput, update };
}
