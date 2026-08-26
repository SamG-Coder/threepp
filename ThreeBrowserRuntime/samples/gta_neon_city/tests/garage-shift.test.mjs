import assert from "node:assert/strict";
import test from "node:test";
import {
  GARAGE_FAULTS,
  GARAGE_PARTS,
  GARAGE_SHIFT_SAVE_VERSION,
  GARAGE_SHIFT_STAGES,
  PULSE_GARAGE_ANCHORS,
  PULSE_GARAGE_POSTED_HOURS,
  createGarageDailyWorkOrders,
  createGarageShiftSystem,
  createPulseGarageShift,
} from "../src/game/garage-shift.mjs";

const MONDAY_MORNING = Object.freeze({ dayIndex: 0, timeHours: 8 });

function faultForOrder(order) {
  const value = GARAGE_FAULTS.find(fault => fault.request === order.request);
  assert.ok(value, `test could not resolve authored request: ${order.request}`);
  return value;
}

function enterRepair(system, { dayIndex = 0, mechanicSkill = 50, orderIndex = 0 } = {}) {
  const order = system.dailyWorkOrders(dayIndex)[orderIndex];
  const fault = faultForOrder(order);
  assert.equal(system.clockIn({ dayIndex, timeHours: 8, mechanicSkill, workOrderId: order.id }).accepted, true);
  assert.equal(system.greetCustomer().accepted, true);
  for (let index = 0; index < fault.clues.length; ++index) assert.equal(system.inspect().accepted, true);
  assert.equal(system.snapshot().stage, GARAGE_SHIFT_STAGES.DIAGNOSIS);
  assert.equal(system.diagnose(fault.id).accepted, true);
  assert.equal(system.collectParts(fault.parts).accepted, true);
  assert.equal(system.snapshot().stage, GARAGE_SHIFT_STAGES.REPAIR);
  return { order, fault };
}

function finishRepair(system) {
  let guard = 0;
  while (system.snapshot().stage === GARAGE_SHIFT_STAGES.REPAIR && guard++ < 100) {
    system.update(0.5, { captureSnapshot: false });
  }
  assert.ok(guard < 100, "repair did not settle");
  assert.equal(system.snapshot().stage, GARAGE_SHIFT_STAGES.SAFETY_CHECK);
}

function completeShift(system) {
  finishRepair(system);
  for (const check of system.safetyChecks) assert.equal(system.performSafetyCheck(check.id).accepted, true);
  assert.equal(system.snapshot().stage, GARAGE_SHIFT_STAGES.INVOICE);
  const invoice = system.submitInvoice();
  assert.equal(invoice.accepted, true);
  return invoice.detail;
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("Pulse Garage publishes believable hours, anchors, faults, clues and parts", () => {
  assert.equal(createPulseGarageShift, createGarageShiftSystem);
  assert.match(PULSE_GARAGE_POSTED_HOURS.label, /MON-SAT 07:30-18:00/);
  assert.ok(PULSE_GARAGE_POSTED_HOURS.lastClockInMinute < PULSE_GARAGE_POSTED_HOURS.closeMinute);
  assert.deepEqual(Object.keys(PULSE_GARAGE_ANCHORS), [
    "clockIn", "serviceDesk", "inspectionBay", "partsCounter", "liftBay", "safetyLane", "office",
  ]);
  assert.ok(Object.values(PULSE_GARAGE_ANCHORS).every(value => value.length === 3 && value.every(Number.isFinite)));
  assert.ok(GARAGE_FAULTS.length >= 4);
  assert.ok(GARAGE_FAULTS.every(value => value.clues.length >= 3 && value.parts.length >= 1));
  assert.ok(GARAGE_FAULTS.every(value => value.clues.every(clue => clue.novice && clue.trained && clue.expert)));
  assert.ok(GARAGE_FAULTS.every(value => value.parts.every(id => GARAGE_PARTS.some(part => part.id === id))));
});

test("day-seeded work boards preserve customer identity and request without leaking diagnosis", () => {
  const first = createGarageDailyWorkOrders(42, { seed: "harbour-save" });
  const second = createGarageDailyWorkOrders(42, { seed: "harbour-save" });
  const nextDay = createGarageDailyWorkOrders(43, { seed: "harbour-save" });
  assert.deepEqual(second, first);
  assert.notDeepEqual(nextDay, first);
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map(value => value.id)).size, 3);
  assert.equal(new Set(first.map(value => value.customerId)).size, 3);
  for (const order of first) {
    assert.equal(order.customer.id, order.customerId);
    assert.equal(order.customer.name, order.customerName);
    assert.equal(typeof order.request, "string");
    assert.ok(order.request.length > 20);
    assert.equal("faultId" in order, false);
    assert.equal("_faultId" in order, false);
    assertDeepFrozen(order);
  }
});

test("posted hours, one-shift-per-day and supplied physical anchors gate clock-in", () => {
  const anchors = { clockIn: [400, 2, -200], liftBay: { x: 420, y: 2, z: -200 } };
  const system = createGarageShiftSystem({ anchors, interactionRadius: 3 });
  assert.deepEqual(system.anchors.clockIn, [400, 2, -200]);
  assert.deepEqual(system.anchors.liftBay, [420, 2, -200]);
  assert.equal(system.availability({ dayIndex: 0, timeHours: 7 }).reason, "not_open_yet");
  assert.equal(system.availability({ dayIndex: 0, timeHours: 17 }).reason, "clock_in_closed");
  assert.equal(system.availability({ dayIndex: 6, timeHours: 10 }).reason, "closed_day");
  assert.equal(system.clockIn({ ...MONDAY_MORNING, position: [0, 0, 0] }).reason, "too_far");
  assert.equal(system.clockIn({ ...MONDAY_MORNING, inVehicle: true, position: anchors.clockIn }).reason, "on_foot_required");
  assert.equal(system.clockIn({ ...MONDAY_MORNING, position: anchors.clockIn }).accepted, true);

  system.greetCustomer();
  const fault = faultForOrder(system.snapshot().workOrder);
  for (const _ of fault.clues) system.inspect();
  system.diagnose(fault.id);
  system.collectParts(fault.parts);
  completeShift(system);
  system.reset();
  assert.equal(system.availability(MONDAY_MORNING).reason, "one_shift_per_day");
  assert.equal(system.availability({ dayIndex: 1, timeHours: 8 }).canClockIn, true);
});

test("the exact apprentice lifecycle produces quality-based one-shot wage and XP", () => {
  const system = createGarageShiftSystem({ seed: "lifecycle" });
  const { order } = enterRepair(system, { mechanicSkill: 82 });
  assert.equal(system.snapshot().customerId, order.customerId);
  assert.equal(system.snapshot().request, order.request);
  assert.equal(system.snapshot().clueTier, "expert");
  assert.ok(system.snapshot().inspectionClues.every(value => value.tier === "expert" && value.clarity === 0.95));

  const payout = completeShift(system);
  assert.equal(payout.quality, 100);
  assert.equal(payout.wage, 180);
  assert.equal(payout.mechanicXp, 65);
  assert.equal(system.snapshot().stage, GARAGE_SHIFT_STAGES.COMPLETE);
  const beforeSerial = system.snapshot().eventSerial;
  assert.equal(system.submitInvoice().reason, "invoice_already_submitted");
  assert.equal(system.snapshot().eventSerial, beforeSerial, "a repeated invoice cannot replay reward events");

  const events = system.drainEvents();
  assert.equal(new Set(events.map(value => value.serial)).size, events.length);
  assert.equal(events.filter(value => value.type === "garage_shift_completed").length, 1);
  assert.equal(events.filter(value => value.type === "garage_invoice_submitted").length, 1);
  assert.strictEqual(system.drainEvents(), system.drainEvents());
  assert.equal(system.drainEvents().length, 0);
});

test("mechanic skill improves clue specificity without changing the seeded case", () => {
  const novice = createGarageShiftSystem({ seed: "same-case" });
  const expert = createGarageShiftSystem({ seed: "same-case" });
  const noviceOrder = novice.dailyWorkOrders(1)[0];
  const expertOrder = expert.dailyWorkOrders(1)[0];
  assert.deepEqual(expertOrder, noviceOrder);
  novice.clockIn({ dayIndex: 1, timeHours: 8, workOrderId: noviceOrder.id, mechanicSkill: 5 });
  expert.clockIn({ dayIndex: 1, timeHours: 8, workOrderId: expertOrder.id, mechanicSkill: 95 });
  novice.greetCustomer();
  expert.greetCustomer();
  const noviceClue = novice.inspect().detail;
  const expertClue = expert.inspect().detail;
  assert.equal(expertClue.id, noviceClue.id);
  assert.equal(noviceClue.tier, "novice");
  assert.equal(expertClue.tier, "expert");
  assert.ok(expertClue.clarity > noviceClue.clarity);
  assert.notEqual(expertClue.observation, noviceClue.observation);
});

test("wrong diagnosis and parts create safe rework, quality loss and time rather than harm", () => {
  const perfect = createGarageShiftSystem({ seed: "rework" });
  const reworked = createGarageShiftSystem({ seed: "rework" });
  enterRepair(perfect, { mechanicSkill: 50 });
  const perfectPayout = completeShift(perfect);

  const order = reworked.dailyWorkOrders(0)[0];
  const correctFault = faultForOrder(order);
  reworked.clockIn({ ...MONDAY_MORNING, mechanicSkill: 50, workOrderId: order.id });
  reworked.greetCustomer();
  for (const _ of correctFault.clues) reworked.inspect();
  const wrongFault = GARAGE_FAULTS.find(value => value.id !== correctFault.id);
  const wrongDiagnosis = reworked.diagnose(wrongFault.id);
  assert.deepEqual(wrongDiagnosis.detail, { correct: false, reworkRequired: true, safe: true, harm: false });
  const eventSerial = reworked.snapshot().eventSerial;
  assert.equal(reworked.diagnose(wrongFault.id).reason, "diagnosis_already_tried");
  assert.equal(reworked.snapshot().eventSerial, eventSerial);
  reworked.diagnose(correctFault.id);
  const wrongPart = GARAGE_PARTS.find(value => !correctFault.parts.includes(value.id));
  const wrongParts = reworked.collectParts([wrongPart.id]);
  assert.equal(wrongParts.detail.safe, true);
  assert.equal(wrongParts.detail.installed, false);
  reworked.collectParts(correctFault.parts);
  const reworkedPayout = completeShift(reworked);
  assert.equal(reworkedPayout.quality, 85);
  assert.equal(reworkedPayout.reworkCount, 2);
  assert.equal(reworked.snapshot().timePenaltyMinutes, 20);
  assert.ok(reworkedPayout.workMinutes > perfectPayout.workMinutes);
  assert.ok(reworkedPayout.wage < perfectPayout.wage);
  assert.ok(reworkedPayout.mechanicXp < perfectPayout.mechanicXp);
  assert.ok(reworked.drainEvents().filter(value => /rework/.test(value.type)).every(value => value.safe === true));
});

test("mid-repair save and restore preserve every bit and continue identically", () => {
  const source = createGarageShiftSystem({ seed: "exact-save", repairTimeScale: 1.75 });
  enterRepair(source, { dayIndex: 2, mechanicSkill: 37, orderIndex: 1 });
  source.update(0.625, { captureSnapshot: false });
  source.update(0.25, { captureSnapshot: false });
  const saved = source.save();

  const restored = createGarageShiftSystem({ seed: "exact-save", repairTimeScale: 1.75 });
  restored.restore(structuredClone(saved));
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.snapshot(), source.snapshot());

  for (let index = 0; index < 40; ++index) {
    source.update(0.5, { captureSnapshot: false });
    restored.update(0.5, { captureSnapshot: false });
  }
  assert.deepEqual(restored.save(), source.save());
  assert.deepEqual(restored.snapshot(), source.snapshot());
});

test("hostile or internally contradictory saves fail before mutating live state", () => {
  const system = createGarageShiftSystem({ seed: "hostile", repairTimeScale: 1.25 });
  enterRepair(system, { mechanicSkill: 44 });
  system.update(0.75, { captureSnapshot: false });
  const valid = structuredClone(system.save());
  const before = system.save();

  const corruptions = [
    value => { value.version = GARAGE_SHIFT_SAVE_VERSION + 1; },
    value => { value.stage = "teleport_to_payout"; },
    value => { value.workOrderId = "forged-order"; },
    value => { value.quality = 1000; },
    value => { value.quality -= 9; },
    value => { value.reworkCount = 999; },
    value => { value.revealedClueIds.push(value.revealedClueIds[0]); },
    value => { value.repairDurationSeconds += 5; },
    value => { value.repairElapsedSeconds = value.repairDurationSeconds + 1; },
    value => { value.active = false; },
    value => { value.pendingEvents[0].serial = value.eventSerial + 1; },
    value => { value.untrusted = true; },
  ];
  for (const corrupt of corruptions) {
    const hostile = structuredClone(valid);
    corrupt(hostile);
    assert.throws(() => system.restore(hostile));
    assert.deepEqual(system.save(), before, "failed restore must be transactional");
  }
});

test("snapshots and save publications are recursively immutable", () => {
  const system = createGarageShiftSystem();
  system.clockIn({ ...MONDAY_MORNING, mechanicSkill: 78 });
  system.greetCustomer();
  system.inspect();
  const state = system.snapshot();
  assert.strictEqual(system.snapshot(), state, "unchanged state should reuse the immutable snapshot");
  assertDeepFrozen(state);
  assertDeepFrozen(system.save());
  assert.throws(() => { state.workOrder.customer.name = "FORGED"; }, TypeError);
  assert.throws(() => { state.inspectionClues.push({}); }, TypeError);
  assert.equal(system.snapshot().workOrder.customer.name, state.customerName);
});

test("RAM-only prewarm covers the complete vocabulary without changing live state", () => {
  const system = createGarageShiftSystem({ seed: "prewarm" });
  system.clockIn({ ...MONDAY_MORNING, mechanicSkill: 31 });
  system.greetCustomer();
  system.inspect();
  const before = system.save();
  const bits = JSON.stringify(before);
  const prepared = system.prewarm();
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.faultsPrepared, GARAGE_FAULTS.length);
  assert.ok(prepared.cluesPrepared >= GARAGE_FAULTS.length * 3);
  assert.equal(prepared.stagesPrepared, Object.keys(GARAGE_SHIFT_STAGES).length);
  assert.equal(prepared.runtimeAssetsCreated, 0);
  assert.equal(prepared.liveStateUnchanged, true);
  assert.ok(prepared.checksum > 0);
  assert.strictEqual(system.prewarm(), prepared);
  assert.equal(JSON.stringify(system.save()), bits);
  assert.deepEqual(system.save(), before);
});
