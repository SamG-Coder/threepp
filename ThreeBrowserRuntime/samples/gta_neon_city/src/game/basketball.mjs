import * as THREE from "three/webgpu";

export const BASKETBALL_SAVE_VERSION = 1;

export const BASKETBALL_STAGES = Object.freeze({
  IDLE: "idle",
  WALK: "walk_to_spot",
  CHARGING: "charging",
  FLIGHT: "ball_flight",
  COMPLETE: "complete",
  FAILED: "failed",
});

const DEFAULT_HUB = Object.freeze([131.2, 0.34, -96]);
const DEFAULT_HOOP = Object.freeze([149.05, 3.18, -96]);

export const BASKETBALL_SHOTS = Object.freeze([
  Object.freeze({ label: "FREE-THROW LINE", position: Object.freeze([140.6, 0.34, -96]), points: 2 }),
  Object.freeze({ label: "NORTH WING", position: Object.freeze([137.2, 0.34, -105.4]), points: 3 }),
  Object.freeze({ label: "SOUTH WING", position: Object.freeze([137.2, 0.34, -86.6]), points: 3 }),
  Object.freeze({ label: "NORTH CORNER", position: Object.freeze([143.0, 0.34, -109.0]), points: 3 }),
  Object.freeze({ label: "SOUTH CORNER", position: Object.freeze([143.0, 0.34, -83.0]), points: 3 }),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value)));
}

function point(value, fallback = [0, 0, 0]) {
  const source = value?.position ?? value ?? fallback;
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    return [finite(source[0]), finite(source[1]), finite(source[2])];
  }
  return [finite(source?.x), finite(source?.y), finite(source?.z)];
}

function distanceSquared(aValue, bValue) {
  const a = point(aValue);
  const b = point(bValue);
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

function validStage(value) {
  const stage = String(value ?? "");
  return Object.values(BASKETBALL_STAGES).includes(stage) ? stage : BASKETBALL_STAGES.IDLE;
}

/**
 * A deterministic, renderer-optional basketball loop. The activity owns one
 * preallocated ball and shadow when a scene is supplied; no shot creates a
 * mesh, material or texture during play.
 */
export function createBasketballActivity({
  scene = null,
  hubPosition = DEFAULT_HUB,
  hoopPosition = DEFAULT_HOOP,
  shots = BASKETBALL_SHOTS,
  reachRadius = 2.25,
  targetRelease = 0.72,
  goodWindow = 0.135,
  perfectWindow = 0.045,
  chargeSpeed = 0.76,
  flightDuration = 1.22,
  timeLimit = 150,
} = {}) {
  const hub = Object.freeze(point(hubPosition));
  const hoop = Object.freeze(point(hoopPosition));
  const shotList = Object.freeze((shots?.length ? shots : BASKETBALL_SHOTS).map((shot, index) => Object.freeze({
    label: String(shot?.label ?? `SHOT ${index + 1}`),
    position: Object.freeze(point(shot?.position)),
    points: Math.max(1, Math.trunc(finite(shot?.points, 2))),
  })));
  const reachSquared = Math.max(0.5, finite(reachRadius, 2.25)) ** 2;
  const releaseTarget = clamp(targetRelease, 0.2, 0.9);
  const releaseWindow = clamp(goodWindow, 0.03, 0.3);
  const perfectReleaseWindow = clamp(perfectWindow, 0.01, releaseWindow);
  const meterSpeed = clamp(chargeSpeed, 0.25, 2.5);
  const shotFlightDuration = clamp(flightDuration, 0.65, 2.4);
  const maximumTime = Math.max(30, finite(timeLimit, 150));

  let stage = BASKETBALL_STAGES.IDLE;
  let shotIndex = 0;
  let activeElapsed = 0;
  let charge = 0;
  let chargeDirection = 1;
  let flightElapsed = 0;
  let made = 0;
  let perfects = 0;
  let points = 0;
  let payout = 0;
  let completedCount = 0;
  let failedCount = 0;
  let lastEvent = null;
  let failureReason = null;
  let releaseRating = null;
  let shotMade = false;
  let shotValue = 0;
  let flightStart = [...shotList[0].position];
  let flightRim = [...hoop];
  let flightLanding = [hoop[0] - 0.4, 0.36, hoop[2]];

  const root = new THREE.Group();
  root.name = "Preallocated Harbour Court basketball activity";
  root.visible = false;
  const ballGeometry = new THREE.SphereGeometry(0.155, 16, 10);
  const ballMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xc76522, roughness: 0.72, metalness: 0.01 });
  ballMaterial.name = "Scuffed leather basketball";
  const ball = new THREE.Mesh(ballGeometry, ballMaterial);
  ball.name = "Reusable activity basketball";
  ball.castShadow = true;
  ball.receiveShadow = true;
  root.add(ball);
  scene?.add?.(root);

  function currentShot() {
    return shotList[Math.min(shotIndex, shotList.length - 1)] ?? null;
  }

  function setBallVisible(visible) {
    root.visible = Boolean(visible);
    ball.visible = Boolean(visible);
  }

  function resetBall() {
    setBallVisible(false);
    ball.position.set(0, 0, 0);
    ball.rotation.set(0, 0, 0);
  }

  function begin(context = {}) {
    if (stage === BASKETBALL_STAGES.WALK || stage === BASKETBALL_STAGES.CHARGING || stage === BASKETBALL_STAGES.FLIGHT) {
      return snapshot();
    }
    if (context.inVehicle) return Object.freeze({ accepted: false, reason: "on_foot_required", activity: "harbour_court" });
    stage = BASKETBALL_STAGES.WALK;
    shotIndex = 0;
    activeElapsed = 0;
    charge = 0;
    chargeDirection = 1;
    flightElapsed = 0;
    made = 0;
    perfects = 0;
    points = 0;
    payout = 0;
    failureReason = null;
    releaseRating = null;
    shotMade = false;
    shotValue = 0;
    lastEvent = "activity_started";
    resetBall();
    return snapshot();
  }

  function fail(reason = "activity_failed") {
    if (![BASKETBALL_STAGES.WALK, BASKETBALL_STAGES.CHARGING, BASKETBALL_STAGES.FLIGHT].includes(stage)) return snapshot();
    stage = BASKETBALL_STAGES.FAILED;
    failureReason = String(reason || "activity_failed");
    payout = 0;
    failedCount += 1;
    lastEvent = "activity_failed";
    resetBall();
    return snapshot();
  }

  function releaseShot() {
    const shot = currentShot();
    if (!shot) return snapshot();
    const error = Math.abs(charge - releaseTarget);
    shotMade = error <= releaseWindow;
    const perfect = error <= perfectReleaseWindow;
    releaseRating = perfect ? "PERFECT" : shotMade ? "GOOD" : charge < releaseTarget ? "SHORT" : "LONG";
    shotValue = shot.points;
    flightStart = [shot.position[0], shot.position[1] + 1.42, shot.position[2]];
    const missSide = (shotIndex % 2 ? -1 : 1) * (0.38 + Math.min(0.72, error * 2.25));
    flightRim = [hoop[0], hoop[1], hoop[2] + (shotMade ? 0 : missSide)];
    flightLanding = [hoop[0] - (shotMade ? 0.72 : 1.18), 0.36, hoop[2] + (shotMade ? 0.18 : missSide * 1.55)];
    flightElapsed = 0;
    stage = BASKETBALL_STAGES.FLIGHT;
    lastEvent = perfect ? "perfect_release" : shotMade ? "good_release" : "missed_release";
    ball.position.fromArray(flightStart);
    setBallVisible(true);
    return snapshot();
  }

  function interact(event = {}) {
    if (event.type === "cancel" || event.kind === "cancel") return fail("cancelled");
    if (event.inVehicle) {
      return fail("on_foot_required");
    }
    if (stage === BASKETBALL_STAGES.WALK) {
      const shot = currentShot();
      if (!shot || distanceSquared(event.position, shot.position) > reachSquared) {
        lastEvent = "move_to_shot_spot";
        return snapshot();
      }
      stage = BASKETBALL_STAGES.CHARGING;
      charge = 0.08;
      chargeDirection = 1;
      releaseRating = null;
      lastEvent = "shot_armed";
      return snapshot();
    }
    if (stage === BASKETBALL_STAGES.CHARGING) return releaseShot();
    return snapshot();
  }

  function completeFlight() {
    if (shotMade) {
      made += 1;
      points += shotValue;
      if (releaseRating === "PERFECT") perfects += 1;
      lastEvent = releaseRating === "PERFECT" ? "perfect_basket" : "basket_scored";
    } else lastEvent = "basket_missed";
    shotIndex += 1;
    resetBall();
    if (shotIndex >= shotList.length) {
      stage = BASKETBALL_STAGES.COMPLETE;
      payout = 260 + made * 55 + perfects * 30 + (made === shotList.length ? 120 : 0);
      completedCount += 1;
      lastEvent = "activity_completed";
    } else {
      stage = BASKETBALL_STAGES.WALK;
      charge = 0;
      chargeDirection = 1;
    }
  }

  function placeBallAtFlightTime(elapsedValue) {
    const elapsed = clamp(elapsedValue, 0, shotFlightDuration);
    const rimTime = shotFlightDuration * 0.68;
    if (elapsed <= rimTime) {
      const t = clamp(elapsed / rimTime, 0, 1);
      const oneMinus = 1 - t;
      const distance = Math.hypot(flightRim[0] - flightStart[0], flightRim[2] - flightStart[2]);
      const apex = [
        (flightStart[0] + flightRim[0]) * 0.5,
        Math.max(flightStart[1], flightRim[1]) + 1.75 + distance * 0.055,
        (flightStart[2] + flightRim[2]) * 0.5,
      ];
      ball.position.set(
        oneMinus * oneMinus * flightStart[0] + 2 * oneMinus * t * apex[0] + t * t * flightRim[0],
        oneMinus * oneMinus * flightStart[1] + 2 * oneMinus * t * apex[1] + t * t * flightRim[1],
        oneMinus * oneMinus * flightStart[2] + 2 * oneMinus * t * apex[2] + t * t * flightRim[2],
      );
    } else {
      const t = clamp((elapsed - rimTime) / Math.max(0.01, shotFlightDuration - rimTime), 0, 1);
      ball.position.set(
        THREE.MathUtils.lerp(flightRim[0], flightLanding[0], t),
        THREE.MathUtils.lerp(flightRim[1] - (shotMade ? 0.22 : 0), flightLanding[1], t) + Math.sin(t * Math.PI) * 0.24,
        THREE.MathUtils.lerp(flightRim[2], flightLanding[2], t),
      );
    }
    ball.rotation.set(elapsed * 10.5, 0, elapsed * 3.7);
  }

  function animateBall(delta) {
    flightElapsed += delta;
    placeBallAtFlightTime(flightElapsed);
    if (flightElapsed + 1e-9 >= shotFlightDuration) completeFlight();
  }

  function update(deltaValue, context = {}) {
    const delta = clamp(deltaValue, 0, 0.25);
    if (![BASKETBALL_STAGES.WALK, BASKETBALL_STAGES.CHARGING, BASKETBALL_STAGES.FLIGHT].includes(stage)) return snapshot();
    activeElapsed += delta;
    if (activeElapsed > maximumTime + 1e-9) return fail("time_expired");
    if (context.inVehicle) {
      return fail("on_foot_required");
    }
    if (stage === BASKETBALL_STAGES.CHARGING) {
      charge += delta * meterSpeed * chargeDirection;
      if (charge >= 1) {
        charge = 1;
        chargeDirection = -1;
      } else if (charge <= 0) {
        charge = 0;
        chargeDirection = 1;
      }
    } else if (stage === BASKETBALL_STAGES.FLIGHT) animateBall(delta);
    return snapshot();
  }

  function reset() {
    stage = BASKETBALL_STAGES.IDLE;
    shotIndex = 0;
    activeElapsed = 0;
    charge = 0;
    chargeDirection = 1;
    flightElapsed = 0;
    made = 0;
    perfects = 0;
    points = 0;
    payout = 0;
    failureReason = null;
    releaseRating = null;
    shotMade = false;
    shotValue = 0;
    lastEvent = "activity_reset";
    resetBall();
    return snapshot();
  }

  function save() {
    return {
      version: BASKETBALL_SAVE_VERSION,
      stage,
      shotIndex,
      activeElapsed,
      charge,
      chargeDirection,
      flightElapsed,
      made,
      perfects,
      points,
      payout,
      completedCount,
      failedCount,
      lastEvent,
      failureReason,
      releaseRating,
      shotMade,
      shotValue,
      flightStart: [...flightStart],
      flightRim: [...flightRim],
      flightLanding: [...flightLanding],
    };
  }

  function restore(value = {}) {
    if (Number(value.version ?? BASKETBALL_SAVE_VERSION) !== BASKETBALL_SAVE_VERSION) {
      throw new RangeError("Unsupported basketball activity save version.");
    }
    stage = validStage(value.stage);
    shotIndex = Math.max(0, Math.min(shotList.length, Math.trunc(finite(value.shotIndex))));
    activeElapsed = Math.max(0, finite(value.activeElapsed));
    charge = clamp(value.charge, 0, 1);
    chargeDirection = finite(value.chargeDirection, 1) < 0 ? -1 : 1;
    flightElapsed = clamp(value.flightElapsed, 0, shotFlightDuration);
    made = Math.max(0, Math.min(shotList.length, Math.trunc(finite(value.made))));
    perfects = Math.max(0, Math.min(made, Math.trunc(finite(value.perfects))));
    points = Math.max(0, Math.trunc(finite(value.points)));
    payout = Math.max(0, Math.trunc(finite(value.payout)));
    completedCount = Math.max(0, Math.trunc(finite(value.completedCount)));
    failedCount = Math.max(0, Math.trunc(finite(value.failedCount)));
    lastEvent = value.lastEvent ? String(value.lastEvent) : null;
    failureReason = value.failureReason ? String(value.failureReason) : null;
    releaseRating = value.releaseRating ? String(value.releaseRating) : null;
    shotMade = Boolean(value.shotMade);
    shotValue = Math.max(0, Math.trunc(finite(value.shotValue)));
    flightStart = point(value.flightStart, currentShot()?.position ?? shotList[0].position);
    flightRim = point(value.flightRim, hoop);
    flightLanding = point(value.flightLanding, [hoop[0] - 0.4, 0.36, hoop[2]]);
    if (stage === BASKETBALL_STAGES.FLIGHT) {
      setBallVisible(true);
      placeBallAtFlightTime(flightElapsed);
    } else resetBall();
    return snapshot();
  }

  function available() {
    return Object.freeze({
      id: "harbour_court",
      kind: "basketball",
      title: "HARBOUR COURT",
      description: "Take five timing-based shots on the public waterfront court.",
      hubPosition: hub,
      hubLabel: "HARBOUR COURT BALL RACK",
      onFoot: true,
      reward: 805,
      trustReward: 2,
      consequenceOf: null,
    });
  }

  function snapshot() {
    const shot = currentShot();
    const active = [BASKETBALL_STAGES.WALK, BASKETBALL_STAGES.CHARGING, BASKETBALL_STAGES.FLIGHT].includes(stage);
    const status = stage === BASKETBALL_STAGES.IDLE ? "available" :
      stage === BASKETBALL_STAGES.COMPLETE ? "completed" : stage === BASKETBALL_STAGES.FAILED ? "failed" : "active";
    let objective = "START A FIVE-SHOT ROUND";
    if (stage === BASKETBALL_STAGES.WALK && shot) objective = `REACH ${shot.label} — PRESS E TO SET`;
    else if (stage === BASKETBALL_STAGES.CHARGING) objective = "PRESS E IN THE GREEN WINDOW TO RELEASE";
    else if (stage === BASKETBALL_STAGES.FLIGHT) objective = `${releaseRating ?? "SHOT"} RELEASE — FOLLOW THE BALL`;
    else if (stage === BASKETBALL_STAGES.COMPLETE) objective = `ROUND COMPLETE — ${made}/${shotList.length} MADE`;
    else if (stage === BASKETBALL_STAGES.FAILED) objective = `FAILED — ${String(failureReason).replaceAll("_", " ").toUpperCase()}`;
    return Object.freeze({
      id: "harbour_court",
      kind: "basketball",
      title: "HARBOUR COURT",
      description: "Five shots, one timing meter, no shortcuts.",
      stage,
      status,
      objective,
      targetKind: stage === BASKETBALL_STAGES.WALK ? "interaction" : null,
      targetPosition: stage === BASKETBALL_STAGES.WALK && shot ? shot.position : null,
      hubPosition: hub,
      hoopPosition: hoop,
      stopIndex: Math.min(shotIndex, shotList.length),
      stopCount: shotList.length,
      shotIndex: Math.min(shotIndex, shotList.length),
      shotLabel: shot?.label ?? null,
      shotValue: shot?.points ?? 0,
      activeElapsed,
      timeRemaining: active ? Math.max(0, maximumTime - activeElapsed) : null,
      charge,
      targetRelease: releaseTarget,
      goodWindow: releaseWindow,
      releaseRating,
      made,
      perfects,
      points,
      payout,
      estimatedReward: 805,
      trustReward: 2,
      completedCount,
      failedCount,
      failureReason,
      lastEvent,
      ballVisible: root.visible,
      ballPosition: root.visible ? Object.freeze(ball.position.toArray()) : null,
    });
  }

  function prewarm() {
    const previous = save();
    reset();
    begin({ inVehicle: false });
    interact({ position: shotList[0].position, inVehicle: false });
    for (let step = 0; step < 240 && snapshot().charge < releaseTarget - 0.004; ++step) {
      update(1 / 120, { inVehicle: false });
    }
    interact({ position: shotList[0].position, inVehicle: false });
    for (let elapsed = 0; elapsed < shotFlightDuration + 0.1; elapsed += 1 / 60) update(1 / 60, { inVehicle: false });
    const preparedMadeFlight = made > 0;
    reset();
    begin({ inVehicle: false });
    interact({ position: shotList[0].position, inVehicle: false });
    update(0.05, { inVehicle: false });
    interact({ position: shotList[0].position, inVehicle: false });
    for (let elapsed = 0; elapsed < shotFlightDuration + 0.1; elapsed += 1 / 60) update(1 / 60, { inVehicle: false });
    const preparedMissFlight = made === 0;
    restore(previous);
    return Object.freeze({ preparedMadeFlight, preparedMissFlight, meshes: 1, storage: "memory-only" });
  }

  function dispose() {
    root.removeFromParent();
    root.clear();
    ballGeometry.dispose();
    ballMaterial.dispose();
  }

  return { begin, interact, notify: interact, update, reset, save, restore, snapshot, available, prewarm, dispose, root };
}
