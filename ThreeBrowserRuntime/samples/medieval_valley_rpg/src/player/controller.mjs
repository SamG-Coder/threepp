import * as THREE_DEFAULT from "three/webgpu";
import { COMBAT_STATES } from "./combat.mjs";
import {
  actionDown,
  actionPressed,
  clampDelta,
  consumeLookDelta,
  emitEvent,
  readAxis,
  resolveCharacterMotion,
} from "./runtime-contracts.mjs";

const DEFAULT_ACTIONS = Object.freeze({
  forward: "moveForward",
  backward: "moveBackward",
  left: "moveLeft",
  right: "moveRight",
  sprint: "sprint",
  jump: "jump",
  dodge: "dodge",
  lightAttack: "lightAttack",
  heavyAttack: "heavyAttack",
  block: "block",
  interact: "interact",
  nextWeapon: "nextWeapon",
});

/**
 * Camera-relative third-person locomotion. Input is an action/axis service, not
 * DOM events; see player/README.md for the small adapter contract.
 */
export class ThirdPersonController {
  constructor({
    THREE: THREE_NS = THREE_DEFAULT,
    owner,
    camera = null,
    input = null,
    world = null,
    services = {},
    events = services?.events ?? null,
    actions = {},
    config = {},
  } = {}) {
    if (!owner?.root) throw new TypeError("ThirdPersonController requires an owner with root");
    this.THREE = THREE_NS;
    this.owner = owner;
    this.camera = camera;
    this.input = input;
    this.world = world;
    this.services = services;
    this.events = events;
    this.actions = { ...DEFAULT_ACTIONS, ...actions };
    this.config = {
      walkSpeed: 3.6,
      sprintSpeed: 6.4,
      acceleration: 18,
      airAcceleration: 5.5,
      turnSpeed: 13,
      gravity: 24,
      jumpSpeed: 8,
      sprintDrain: 18,
      dodgeSpeed: 9.5,
      stepHeight: 0.42,
      slopeLimit: Math.PI * 0.34,
      capsule: { radius: 0.38, height: 1.72 },
      cameraDistance: 4.8,
      cameraHeight: 1.55,
      cameraShoulder: 0.42,
      cameraPitchMin: -0.7,
      cameraPitchMax: 0.74,
      lookSensitivity: 0.0024,
      cameraSharpness: 14,
      ...config,
    };
    this.config.capsule = { radius: 0.38, height: 1.72, ...(config.capsule ?? {}) };
    this.velocity = new THREE_NS.Vector3();
    this.moveDirection = new THREE_NS.Vector3();
    this.facingDirection = new THREE_NS.Vector3(0, 0, -1);
    this.cameraYaw = Number(owner.root.rotation.y) || 0;
    this.cameraPitch = 0.2;
    this.grounded = false;
    this.isSprinting = false;
    this.stepped = false;
    this.blocked = false;
    this.enabled = true;
    this._pressed = new Map();
    this._stepDistance = 0;
    this._cameraTarget = new THREE_NS.Vector3();
    this._cameraDesired = new THREE_NS.Vector3();
    this._cameraForward = new THREE_NS.Vector3();
    this._cameraRight = new THREE_NS.Vector3();
    this._cameraSegment = new THREE_NS.Vector3();
    this._displacement = new THREE_NS.Vector3();
    this._horizontal = new THREE_NS.Vector3();
    this._quaternion = new THREE_NS.Quaternion();
    this._up = new THREE_NS.Vector3(0, 1, 0);
  }

  setInput(input) { this.input = input; }
  setCamera(camera) { this.camera = camera; }

  update(delta) {
    const dt = clampDelta(delta);
    if (dt <= 0 || !this.enabled) return this.snapshot();
    const combat = this.owner.combat;
    if (combat?.isDead?.()) {
      this.isSprinting = false;
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 8));
      this._updateCamera(dt);
      return this.snapshot();
    }

    this._readLook();
    this._readActions();
    this._move(dt);
    this._updateCamera(dt);
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      velocity: this.velocity.clone(),
      moveDirection: this.moveDirection.clone(),
      grounded: this.grounded,
      sprinting: this.isSprinting,
      stepped: this.stepped,
      blocked: this.blocked,
      cameraYaw: this.cameraYaw,
      cameraPitch: this.cameraPitch,
    });
  }

  _pressedNow(action) {
    const signalled = actionPressed(this.input, action);
    const down = actionDown(this.input, action);
    const previous = this._pressed.get(action) ?? false;
    const active = signalled || down;
    this._pressed.set(action, active);
    return active && !previous;
  }

  _readLook() {
    const look = consumeLookDelta(this.input);
    const sensitivity = Number(this.config.lookSensitivity);
    this.cameraYaw -= look.x * sensitivity;
    this.cameraPitch = this.THREE.MathUtils.clamp(
      this.cameraPitch - look.y * sensitivity,
      this.config.cameraPitchMin,
      this.config.cameraPitchMax,
    );
  }

  _readActions() {
    const combat = this.owner.combat;
    if (!combat) return;
    combat.setBlocking(actionDown(this.input, this.actions.block));
    if (this._pressedNow(this.actions.lightAttack)) combat.requestAttack("light");
    if (this._pressedNow(this.actions.heavyAttack)) combat.requestAttack("heavy");
    if (this._pressedNow(this.actions.dodge)) {
      const dodgeX = readAxis(this.input, "moveX", this.actions.left, this.actions.right);
      const dodgeZ = readAxis(this.input, "moveY", this.actions.forward, this.actions.backward);
      this._cameraForward.set(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
      this._cameraRight.set(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
      this.moveDirection.copy(this._cameraRight).multiplyScalar(dodgeX).addScaledVector(this._cameraForward, -dodgeZ);
      if (this.moveDirection.lengthSq() > 1) this.moveDirection.normalize();
      const direction = this.moveDirection.lengthSq() > 0.01 ? this.moveDirection : this.facingDirection;
      combat.requestDodge(direction);
    }
    if (this._pressedNow(this.actions.jump) && this.grounded && !combat.isBusy()) {
      if (combat.spendStamina(Number(this.config.jumpStamina ?? 8), "jump")) {
        this.velocity.y = this.config.jumpSpeed;
        this.grounded = false;
        emitEvent(this.events, "player:jump", { actor: this.owner });
      }
    }
    if (this._pressedNow(this.actions.interact)) {
      const result = this.services?.interaction?.interact?.(this.owner)
        ?? this.world?.interact?.(this.owner)
        ?? null;
      emitEvent(this.events, "player:interact", { actor: this.owner, result });
    }
    if (this._pressedNow(this.actions.nextWeapon)) this.owner.cycleWeapon?.();
  }

  _move(dt) {
    const x = readAxis(this.input, "moveX", this.actions.left, this.actions.right);
    const z = readAxis(this.input, "moveY", this.actions.forward, this.actions.backward);
    this._cameraForward.set(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    this._cameraRight.set(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    this.moveDirection.copy(this._cameraRight).multiplyScalar(x).addScaledVector(this._cameraForward, -z);
    if (this.moveDirection.lengthSq() > 1) this.moveDirection.normalize();

    const combat = this.owner.combat;
    const canSprint = this.moveDirection.lengthSq() > 0.2
      && actionDown(this.input, this.actions.sprint)
      && this.grounded
      && combat?.state === COMBAT_STATES.IDLE
      && this.owner.stats.stamina > 0;
    this.isSprinting = Boolean(canSprint && combat.spendStamina(this.config.sprintDrain * dt, "sprint"));

    let speed = this.isSprinting ? this.config.sprintSpeed : this.config.walkSpeed;
    if (combat?.state === COMBAT_STATES.BLOCKING) speed *= 0.42;
    else if (combat?.state === COMBAT_STATES.WINDUP) speed *= 0.35;
    else if (combat?.state === COMBAT_STATES.RECOVERY) speed *= 0.55;
    else if (combat?.state === COMBAT_STATES.STAGGERED) speed = 0;

    if (combat?.state === COMBAT_STATES.DODGING) {
      this.moveDirection.copy(combat.dodgeDirection);
      speed = this.config.dodgeSpeed * (1 - Math.min(0.38, combat.elapsed / Math.max(0.01, combat.duration)));
    }
    const acceleration = this.grounded ? this.config.acceleration : this.config.airAcceleration;
    this._horizontal.set(this.velocity.x, 0, this.velocity.z);
    const targetX = this.moveDirection.x * speed;
    const targetZ = this.moveDirection.z * speed;
    const blend = 1 - Math.exp(-acceleration * dt);
    this._horizontal.x = this.THREE.MathUtils.lerp(this._horizontal.x, targetX, blend);
    this._horizontal.z = this.THREE.MathUtils.lerp(this._horizontal.z, targetZ, blend);
    this.velocity.x = this._horizontal.x;
    this.velocity.z = this._horizontal.z;
    if (!this.grounded) this.velocity.y -= this.config.gravity * dt;
    else if (this.velocity.y < 0) this.velocity.y = -0.5;

    this._displacement.copy(this.velocity).multiplyScalar(dt);
    const resolved = resolveCharacterMotion({
      THREE: this.THREE,
      world: this.world,
      actor: this.owner,
      position: this.owner.root.position,
      velocity: this.velocity,
      displacement: this._displacement,
      capsule: this.config.capsule,
      stepHeight: this.config.stepHeight,
      slopeLimit: this.config.slopeLimit,
      delta: dt,
    });
    this.owner.root.position.copy(resolved.position);
    this.velocity.copy(resolved.velocity);
    this.grounded = resolved.grounded;
    this.stepped = resolved.stepped;
    this.blocked = resolved.blocked;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && horizontalSpeed > 0.35) {
      this._stepDistance += horizontalSpeed * dt;
      const stride = this.isSprinting ? 1.45 : 1.05;
      if (this._stepDistance >= stride) {
        this._stepDistance %= stride;
        const ground = this.world?.sampleGround?.(this.owner.root.position.x, this.owner.root.position.z, this.owner);
        emitEvent(this.events, "player:step", {
          actor: this.owner,
          position: this.owner.root.position.clone(),
          speed: horizontalSpeed,
          sprinting: this.isSprinting,
          surfaceId: ground?.surfaceId ?? ground?.material ?? null,
        });
      }
    } else if (!this.grounded) this._stepDistance = 0;
    if (resolved.stepped) emitEvent(this.events, "player:step-up", { actor: this.owner, position: this.owner.root.position.clone() });

    const face = combat?.state === COMBAT_STATES.BLOCKING || combat?.isAttacking?.()
      ? this._cameraForward
      : this.moveDirection;
    if (face.lengthSq() > 0.02) {
      this.facingDirection.copy(face).normalize();
      const desiredYaw = Math.atan2(-this.facingDirection.x, -this.facingDirection.z);
      const difference = Math.atan2(Math.sin(desiredYaw - this.owner.root.rotation.y), Math.cos(desiredYaw - this.owner.root.rotation.y));
      this.owner.root.rotation.y += difference * (1 - Math.exp(-this.config.turnSpeed * dt));
      this.owner.yaw = this.owner.root.rotation.y;
    }
    emitEvent(this.events, "player:motion", {
      actor: this.owner,
      velocity: this.velocity.clone(),
      grounded: this.grounded,
      stepped: this.stepped,
      sprinting: this.isSprinting,
    });
  }

  _updateCamera(dt) {
    if (!this.camera) return;
    this._cameraTarget.copy(this.owner.root.position).addScaledVector(this._up, this.config.cameraHeight);
    const cosPitch = Math.cos(this.cameraPitch);
    this._cameraForward.set(
      -Math.sin(this.cameraYaw) * cosPitch,
      Math.sin(this.cameraPitch),
      -Math.cos(this.cameraYaw) * cosPitch,
    );
    this._cameraRight.set(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    this._cameraDesired.copy(this._cameraTarget)
      .addScaledVector(this._cameraForward, -this.config.cameraDistance)
      .addScaledVector(this._cameraRight, this.config.cameraShoulder);
    const clipped = this.world?.clipCamera?.({
      actor: this.owner,
      target: this._cameraTarget,
      desired: this._cameraDesired,
      radius: 0.18,
    }) ?? this.world?.physics?.clipCamera?.(this._cameraTarget, this._cameraDesired, 0.18);
    if (clipped?.position) this._cameraDesired.copy(clipped.position);
    else if (clipped?.isVector3) this._cameraDesired.copy(clipped);
    else this._clipCameraAgainstWorld();
    const blend = 1 - Math.exp(-this.config.cameraSharpness * dt);
    this.camera.position.lerp(this._cameraDesired, blend);
    this.camera.lookAt(this._cameraTarget);
  }

  _clipCameraAgainstWorld() {
    this._cameraSegment.copy(this._cameraDesired).sub(this._cameraTarget);
    let earliest = 1;
    const radius = 0.18;
    for (const blocker of this.world?.blockers ?? []) {
      if (!blocker?.active || blocker.shape !== "aabb" || !blocker.center || !blocker.halfExtents) continue;
      let minimum = 0;
      let maximum = earliest;
      let intersects = true;
      for (let axis = 0; axis < 3; axis += 1) {
        const origin = this._cameraTarget.getComponent(axis);
        const direction = this._cameraSegment.getComponent(axis);
        const center = Number(blocker.center[axis]) || 0;
        const extent = (Number(blocker.halfExtents[axis]) || 0) + radius;
        if (Math.abs(direction) < 1e-7) {
          if (origin < center - extent || origin > center + extent) intersects = false;
          continue;
        }
        let near = (center - extent - origin) / direction;
        let far = (center + extent - origin) / direction;
        if (near > far) [near, far] = [far, near];
        minimum = Math.max(minimum, near);
        maximum = Math.min(maximum, far);
        if (minimum > maximum) { intersects = false; break; }
      }
      if (intersects && minimum >= 0 && minimum <= earliest) earliest = minimum;
    }
    if (earliest < 1) this._cameraDesired.copy(this._cameraTarget).addScaledVector(this._cameraSegment, Math.max(0.06, earliest - 0.025));
    const ground = this.world?.terrainHeight?.(this._cameraDesired.x, this._cameraDesired.z)
      ?? this.world?.sampleGround?.(this._cameraDesired.x, this._cameraDesired.z)?.height;
    if (Number.isFinite(Number(ground))) this._cameraDesired.y = Math.max(this._cameraDesired.y, Number(ground) + 0.24);
  }
}

export function createPlayerController(options) {
  return new ThirdPersonController(options);
}
