import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAPTER_TWO_AFTERMATH_HOOKS,
  CHAPTER_TWO_CHOICE,
  CHAPTER_TWO_CLUES,
  CHAPTER_TWO_PHASES,
  CHAPTER_TWO_SAVE_VERSION,
  CHAPTER_TWO_SEQUENCES,
  createBorrowedTimeChapter,
} from "../src/game/chapter-two.mjs";

function finishActive(chapter) {
  const lines = [];
  let guard = 0;
  while (chapter.snapshot().line && guard++ < 128) {
    lines.push(chapter.snapshot().line.text);
    chapter.advanceLine();
  }
  assert.ok(guard < 128, "Chapter Two dialogue must terminate deterministically");
  return lines;
}

function finishGarageEvidence(chapter, order = CHAPTER_TWO_CLUES.map(clue => clue.id)) {
  const lines = [];
  for (const clueId of order) {
    chapter.inspect(clueId);
    lines.push(...finishActive(chapter));
  }
  return lines;
}

function reachDecision(previousChoice = "publish", manifestMethod = "photograph") {
  const chapter = createBorrowedTimeChapter();
  chapter.notify({ type: "chapter_one_completed", choiceResult: previousChoice });
  finishActive(chapter);
  finishGarageEvidence(chapter);
  chapter.speak("leah_moreno");
  finishActive(chapter);
  chapter.recordManifest(manifestMethod);
  finishActive(chapter);
  assert.equal(chapter.snapshot().phase, CHAPTER_TWO_PHASES.DECISION);
  return chapter;
}

test("Borrowed Time stays locked until Chapter One's evidence choice and owns Juno's mistake", () => {
  const locked = createBorrowedTimeChapter();
  assert.equal(locked.snapshot().phase, CHAPTER_TWO_PHASES.LOCKED);
  locked.begin({ chapterOneChoice: "not_a_real_choice" });
  assert.equal(locked.snapshot().chapterStarted, false);
  assert.equal(locked.snapshot().lastEvent, "chapter_one_choice_required");

  locked.notify({ type: "chapter_one_completed", choiceResult: "publish" });
  assert.equal(locked.snapshot().titleCard, "CHAPTER TWO / BORROWED TIME");
  assert.equal(locked.snapshot().lineCount, CHAPTER_TWO_SEQUENCES.failure_after_publish.lines.length);
  assert.equal(locked.snapshot().line.progress, 0);
  const publishedIntro = finishActive(locked).join(" ");
  assert.match(publishedIntro, /delay was also harm/i);
  assert.match(publishedIntro, /family does not buy Pulse a different rule/i);
  assert.match(publishedIntro, /hose was marked S-17/i);
  assert.match(publishedIntro, /invoice said S-71/i);
  assert.match(publishedIntro, /six hundred dollars left/i);
  assert.match(publishedIntro, /does not make Leah's car safe/i);
  assert.match(publishedIntro, /do not clean up my part/i);
  assert.equal(locked.snapshot().phase, CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE);

  const protectedChapter = createBorrowedTimeChapter();
  protectedChapter.begin("protect");
  const protectedIntro = finishActive(protectedChapter).join(" ");
  assert.match(protectedIntro, /Leah never chose this one/i);
  assert.match(protectedIntro, /cannot mean protecting Pulse from what it did/i);
  assert.equal(protectedChapter.snapshot().chapterOneChoice, "protect");
});

test("a recovered runtime hitch cannot fast-forward Chapter Two dialogue", () => {
  const hitched = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  const bounded = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  hitched.update(30);
  bounded.update(0.25);
  assert.deepEqual(hitched.save(), bounded.save());
  assert.equal(hitched.snapshot().lineIndex, 0);
  assert.equal(hitched.snapshot().lineElapsed, 0.25);
  hitched.update(0.07, { advance: true });
  assert.equal(hitched.snapshot().lineIndex, 1, "manual advance uses the campaign's short input debounce");
});

test("physical evidence and the depot use skippable authored cameras only while their lines are active", () => {
  const chapter = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  finishActive(chapter);

  for (const clue of CHAPTER_TWO_CLUES) {
    chapter.inspect(clue.id);
    const insert = chapter.snapshot();
    assert.equal(insert.sequenceId, clue.sequenceId);
    assert.equal(insert.cinematic, true, `${clue.id} must invoke its authored insert camera`);
    assert.equal(insert.controlsLocked, true, `${clue.id} must lock only during its two evidence lines`);
    assert.equal(insert.line.shot, `evidence_${clue.id === "failed_brake_hose" ? "hose" : clue.id === "supplier_invoice" ? "invoice" : "log"}`);
    chapter.update(0, { skip: true });
    assert.equal(chapter.snapshot().active, false, `${clue.id} must return immediately to investigation after skip`);
    assert.equal(chapter.snapshot().cinematic, false);
    assert.equal(chapter.snapshot().controlsLocked, false);
  }

  chapter.speak("leah_moreno");
  chapter.update(0, { skip: true });
  chapter.recordManifest("photograph");
  assert.equal(chapter.snapshot().line.shot, "manifest_close");
  assert.equal(chapter.snapshot().cinematic, true);
  assert.equal(chapter.snapshot().controlsLocked, true);
  while (chapter.snapshot().lineIndex < 3) chapter.advanceLine();
  assert.equal(chapter.snapshot().line.shot, "depot_wide");
  chapter.advanceLine();
  assert.equal(chapter.snapshot().choice.cameraShot, "depot_choice",
    "the modal choice must retain a render-only Southline tableau without another dialogue line");
  assert.equal(chapter.snapshot().line, null);
  assert.equal(chapter.snapshot().cinematic, true);
  assert.equal(chapter.snapshot().controlsLocked, true);
  assert.equal(Object.values(CHAPTER_TWO_SEQUENCES).reduce((sum, sequence) => sum + sequence.lines.length, 0), 47);
});

test("the garage investigation is nonviolent, accepts any clue order, and cannot duplicate evidence", () => {
  const chapter = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  finishActive(chapter);

  chapter.speak("leah_moreno");
  assert.equal(chapter.snapshot().phase, CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE, "Leah must remain gated behind the physical records");

  const clueOrder = ["service_log", "failed_brake_hose", "supplier_invoice"];
  chapter.inspect("service_log");
  const logText = finishActive(chapter).join(" ");
  assert.match(logText, /Eleven cars/i);
  assert.match(logText, /Seven owners/i);
  assert.match(logText, /Four were fleet jobs/i);
  const recordedOnce = chapter.drainEvents().filter(event => event.type === "clue_recorded" && event.clueId === "service_log").length;
  assert.equal(recordedOnce, 1);

  chapter.inspect("service_log");
  assert.equal(chapter.snapshot().lastEvent, "clue_already_inspected:service_log");
  assert.equal(chapter.drainEvents().filter(event => event.type === "clue_recorded").length, 0);

  const remainingText = finishGarageEvidence(chapter, clueOrder.slice(1)).join(" ");
  assert.match(remainingText, /curb did not cause this/i);
  assert.match(remainingText, /Southline charged us/i);
  assert.deepEqual(chapter.snapshot().inspectedClues, clueOrder);
  assert.equal(chapter.snapshot().phase, CHAPTER_TWO_PHASES.SPEAK_TO_LEAH);
  assert.equal(chapter.snapshot().targetKey, "common_ground_leah");
  assert.ok(CHAPTER_TWO_CLUES.every(clue => clue.kind === "inspect"));
});

test("Leah's account and Southline's manifest lead to a materially honest decision", () => {
  const chapter = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "protect" });
  finishActive(chapter);
  finishGarageEvidence(chapter);

  chapter.notify({ type: "speak_affected", personId: "leah_moreno" });
  const leahText = finishActive(chapter).join(" ");
  assert.match(leahText, /home care at night/i);
  assert.match(leahText, /should not mean gambling on the brakes/i);
  assert.match(leahText, /do not put me in an apology as 'the brave customer/i);
  assert.match(leahText, /You did not gamble\. We did\./i);
  assert.equal(chapter.snapshot().phase, CHAPTER_TWO_PHASES.INSPECT_DEPOT);
  assert.match(chapter.snapshot().objective, /SOUTHLINE/i);

  chapter.notify({ type: "photograph_depot_manifest" });
  const depotText = finishActive(chapter).join(" ");
  assert.match(depotText, /Voss freight authorization/i);
  assert.match(depotText, /three districts/i);
  assert.match(depotText, /four drivers get no warning/i);
  assert.match(depotText, /no clean order/i);
  assert.equal(chapter.snapshot().manifestMethod, "photograph");
  assert.equal(chapter.snapshot().choice.id, "brake_hose_response");
  assert.equal(chapter.snapshot().active, true, "the decision must use the same modal contract as Chapter One");
  assert.equal(chapter.snapshot().cinematic, true);
  assert.equal(chapter.snapshot().controlsLocked, true);
  assert.equal(chapter.snapshot().lineIndex, null);
  assert.match(chapter.snapshot().choice.context, /Voss gets six hours with the evidence/i);
  assert.deepEqual(chapter.snapshot().choice.options.map(option => option.id), ["report_now", "recall_then_report"]);
});

test("reporting immediately preserves reach and evidence while imposing public and livelihood costs", () => {
  const chapter = reachDecision("publish", "inspect");
  assert.throws(() => chapter.choose("perfect_answer"), /Unknown Chapter Two choice/);
  chapter.choose("report_now");
  const consequenceText = finishActive(chapter).join(" ");

  assert.equal(chapter.snapshot().phase, CHAPTER_TWO_PHASES.COMPLETE);
  assert.equal(chapter.snapshot().chapterCompleted, true);
  assert.equal(chapter.snapshot().manifestMethod, "inspect");
  assert.deepEqual(chapter.snapshot().moralLedger, {
    knownDriversProtected: 11,
    unknownDriversAtRisk: 0,
    evidenceAtRisk: 0,
    peoplePubliclyExposed: 11,
    garageSuspensionDays: 30,
    vossLeadHours: 0,
  });
  assert.match(consequenceText, /sealed Pulse Garage for thirty days/i);
  assert.match(consequenceText, /employer called before the tow truck got here/i);
  assert.match(consequenceText, /mechanics did not approve that box/i);
  assert.match(consequenceText, /will not ask you to call that fair/i);
  assert.equal(chapter.snapshot().aftermathHook.id, "open_ledger");
  assert.equal(chapter.snapshot().targetKey, "pulse_garage_recall_desk");
});

test("the bounded recall protects seven people but durably records four unknown drivers and moved evidence", () => {
  const chapter = reachDecision("protect");
  chapter.choose("recall_then_report");
  const consequenceText = finishActive(chapter).join(" ");

  assert.deepEqual(chapter.snapshot().moralLedger, {
    knownDriversProtected: 7,
    unknownDriversAtRisk: 4,
    evidenceAtRisk: 1,
    peoplePubliclyExposed: 7,
    garageSuspensionDays: 30,
    vossLeadHours: 6,
  });
  assert.match(consequenceText, /Seven calls, seven cars parked/i);
  assert.match(consequenceText, /original manifest is gone/i);
  assert.match(consequenceText, /those names are in the filing/i);
  assert.match(consequenceText, /easier to help, not more valuable/i);
  assert.equal(chapter.snapshot().aftermathHook.id, "the_missing_four");
  assert.equal(chapter.snapshot().targetKey, "southline_fleet_records");
});

test("each playable aftermath starts its matching human epilogue once without rewriting the moral ledger", () => {
  const branches = [
    {
      choice: "report_now",
      hookId: "open_ledger",
      wrongHookId: "the_missing_four",
      sequenceId: "open_ledger_epilogue",
      expected: [
        /put my name beside 'fraud' before anyone called/i,
        /protected your body and spent your name/i,
        /call the next person before the notice does/i,
        /support desk stays open/i,
      ],
    },
    {
      choice: "recall_then_report",
      hookId: "the_missing_four",
      wrongHookId: "open_ledger",
      sequenceId: "missing_four_epilogue",
      expected: [
        /turns fleet 44B into Arturo Reyes/i,
        /does not make the three we cannot name worth less/i,
        /search dispatch rosters before another shift changes/i,
        /accountability is not a door we reopen/i,
      ],
    },
  ];

  for (const branch of branches) {
    const chapter = reachDecision("publish");
    chapter.choose(branch.choice);
    finishActive(chapter);
    chapter.drainEvents();
    const ledgerBefore = chapter.snapshot().moralLedger;

    let state = chapter.notify({
      type: "aftermath_completed",
      chapterId: "borrowed_time",
      choiceId: branch.choice,
      hookId: branch.wrongHookId,
    });
    assert.equal(state.sequenceId, null);
    assert.match(state.lastEvent, /hook_mismatch/i);
    assert.equal(state.aftermathEpilogue.started, false);

    state = chapter.notify({
      type: "aftermath_completed",
      chapterId: "borrowed_time",
      choiceId: branch.choice,
      hookId: branch.hookId,
      activityId: branch.hookId,
    });
    assert.equal(state.sequenceId, branch.sequenceId);
    assert.equal(state.titleCard, `AFTERMATH / ${branch.hookId === "open_ledger" ? "THE OPEN LEDGER" : "THE MISSING FOUR"}`);
    assert.equal(state.cinematic, true);
    assert.equal(state.controlsLocked, true);
    assert.deepEqual(state.aftermathEpilogue, {
      hookId: branch.hookId,
      sequenceId: branch.sequenceId,
      started: true,
      completed: false,
    });
    const startedSerial = state.sequenceSerial;

    state = chapter.notify({
      type: "aftermath_completed",
      chapterId: "borrowed_time",
      choiceId: branch.choice,
      hookId: branch.hookId,
    });
    assert.equal(state.sequenceId, branch.sequenceId, "a duplicate completion cannot replace the active epilogue");
    assert.equal(state.sequenceSerial, startedSerial, "a duplicate completion cannot restart the epilogue");
    assert.match(state.lastEvent, /already_started/i);

    const epilogueText = finishActive(chapter).join(" ");
    for (const pattern of branch.expected) assert.match(epilogueText, pattern);
    state = chapter.snapshot();
    assert.equal(state.phase, CHAPTER_TWO_PHASES.COMPLETE);
    assert.equal(state.chapterCompleted, true);
    assert.equal(state.aftermathEpilogue.completed, true);
    assert.ok(state.completedSequences.includes(branch.sequenceId));
    assert.deepEqual(state.moralLedger, ledgerBefore, "helping people after the choice cannot rewrite its cost");

    const events = chapter.drainEvents();
    assert.equal(events.filter(event => event.type === "aftermath_epilogue_started").length, 1);
    assert.equal(events.filter(event => event.type === "aftermath_epilogue_completed").length, 1);
    state = chapter.notify({
      type: "aftermath_completed",
      chapterId: "borrowed_time",
      choiceId: branch.choice,
      hookId: branch.hookId,
    });
    assert.equal(state.active, false);
    assert.equal(state.sequenceSerial, startedSerial);
    assert.match(state.lastEvent, /already_completed/i);
    assert.deepEqual(state.moralLedger, ledgerBefore);
  }
});

test("neither branch is represented as a reward or a cost-free correct answer", () => {
  const [immediate, bounded] = CHAPTER_TWO_CHOICE.options;
  assert.equal("reward" in immediate, false);
  assert.equal("reward" in bounded, false);
  assert.equal("payout" in immediate, false);
  assert.equal("payout" in bounded, false);
  assert.ok(immediate.ledger.peoplePubliclyExposed > bounded.ledger.peoplePubliclyExposed);
  assert.ok(immediate.ledger.garageSuspensionDays > 0);
  assert.ok(bounded.ledger.unknownDriversAtRisk > 0);
  assert.ok(bounded.ledger.evidenceAtRisk > 0);
  assert.notEqual(CHAPTER_TWO_AFTERMATH_HOOKS.report_now.id, CHAPTER_TWO_AFTERMATH_HOOKS.recall_then_report.id);
  assert.notEqual(CHAPTER_TWO_AFTERMATH_HOOKS.report_now.kind, CHAPTER_TWO_AFTERMATH_HOOKS.recall_then_report.kind);
});

test("save and restore are exact mid-line and at the choice, and never replay queued commands", () => {
  const chapter = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  chapter.update(1.375);
  chapter.drainEvents();
  const midLine = chapter.save();
  const restored = createBorrowedTimeChapter();
  restored.restore(midLine);
  assert.deepEqual(restored.save(), midLine);
  assert.deepEqual(restored.drainEvents(), []);

  const decision = reachDecision("protect");
  const pendingBeforeSave = decision.drainEvents();
  assert.ok(pendingBeforeSave.some(event => event.type === "choice_requested"));
  const choiceSave = decision.save();
  const choiceRestored = createBorrowedTimeChapter();
  choiceRestored.restore(choiceSave);
  assert.deepEqual(choiceRestored.save(), choiceSave);
  assert.deepEqual(choiceRestored.drainEvents(), []);
  assert.equal(choiceRestored.snapshot().choice.id, CHAPTER_TWO_CHOICE.id);
  choiceRestored.choose("recall_then_report");
  assert.equal(choiceRestored.drainEvents().filter(event => event.type === "choice_made").length, 1);
  assert.equal(choiceRestored.drainEvents().length, 0);

  finishActive(choiceRestored);
  const hookId = choiceRestored.snapshot().aftermathHook.id;
  choiceRestored.notify({
    type: "aftermath_completed",
    chapterId: "borrowed_time",
    choiceId: "recall_then_report",
    hookId,
  });
  for (let index = 0; index < 4; ++index) choiceRestored.update(0.25);
  choiceRestored.drainEvents();
  const midEpilogue = choiceRestored.save();
  const restoredEpilogue = createBorrowedTimeChapter();
  restoredEpilogue.restore(midEpilogue);
  assert.deepEqual(restoredEpilogue.save(), midEpilogue);
  assert.deepEqual(restoredEpilogue.drainEvents(), []);
  assert.equal(restoredEpilogue.snapshot().sequenceId, "missing_four_epilogue");
  assert.equal(restoredEpilogue.snapshot().lineElapsed, 1);
  finishActive(restoredEpilogue);
  assert.equal(restoredEpilogue.snapshot().aftermathEpilogue.completed, true);
});

test("restore rejects old, future, and structurally invalid Chapter Two saves", () => {
  const chapter = createBorrowedTimeChapter();
  const initial = chapter.save();
  assert.equal(initial.version, CHAPTER_TWO_SAVE_VERSION);
  assert.throws(() => chapter.restore({ ...initial, version: 0 }), /Unsupported Chapter Two save version/);
  assert.throws(() => chapter.restore({ ...initial, version: CHAPTER_TWO_SAVE_VERSION + 1 }), /Unsupported Chapter Two save version/);
  assert.throws(() => chapter.restore({ ...initial, phase: "invented_phase" }), /Unknown Chapter Two phase/);
  assert.throws(() => chapter.restore({ ...initial, inspectedClues: ["service_log", "service_log"] }), /duplicate id/);
  assert.throws(() => chapter.restore({ ...initial, lineIndex: 1 }), /lineIndex requires an active sequence/);
  assert.throws(() => chapter.restore({ ...initial, affectedPersonSpoken: true }), /Leah cannot be recorded/);
  assert.throws(() => chapter.restore({ ...initial, aftermathEpilogueStartedId: "invented_hook" }), /Unknown started Chapter Two aftermath/);
});

test("a version-one Chapter Two save migrates without inventing an aftermath epilogue", () => {
  const completed = reachDecision("protect");
  completed.choose("recall_then_report");
  finishActive(completed);
  const legacy = completed.save();
  legacy.version = 1;
  delete legacy.aftermathEpilogueStartedId;
  delete legacy.aftermathEpilogueCompletedId;

  const restored = createBorrowedTimeChapter();
  const state = restored.restore(legacy);
  assert.equal(restored.save().version, CHAPTER_TWO_SAVE_VERSION);
  assert.equal(state.choiceResult, "recall_then_report");
  assert.equal(state.aftermathHook.id, "the_missing_four");
  assert.equal(state.aftermathEpilogue.started, false);
  assert.equal(state.aftermathEpilogue.completed, false);
  assert.deepEqual(state.moralLedger, completed.snapshot().moralLedger);
});

test("unchanged Chapter Two state reuses one deeply frozen snapshot", () => {
  const chapter = createBorrowedTimeChapter();
  const first = chapter.snapshot();

  assert.strictEqual(chapter.snapshot(), first);
  assert.strictEqual(chapter.notify({ type: "unrelated_runtime_event" }), first, "a true no-op must retain the cached publication");
  assert.strictEqual(chapter.update(0), first, "a zero-time tick must not invent a state revision");
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.chapter));
  assert.ok(Object.isFrozen(first.inspectedClues));
  assert.ok(Object.isFrozen(first.moralLedger));
  assert.ok(Object.isFrozen(first.completedSequences));
  assert.throws(() => {
    first.moralLedger.knownDriversProtected = 99;
  }, TypeError);
  assert.throws(() => {
    first.inspectedClues.push("service_log");
  }, TypeError);
  assert.strictEqual(chapter.snapshot(), first, "failed external mutation cannot poison the cached snapshot");
});

test("every observable Chapter Two mutation invalidates the snapshot cache", () => {
  const chapter = createBorrowedTimeChapter();
  const initialSave = chapter.save();
  let previous = chapter.snapshot();

  function expectFresh(action, label) {
    const returned = action();
    assert.notStrictEqual(returned, previous, `${label} must publish a new snapshot`);
    assert.strictEqual(chapter.snapshot(), returned, `${label} must cache the new publication`);
    previous = returned;
    return returned;
  }

  expectFresh(() => chapter.begin({ chapterOneChoice: "invalid" }), "blocked begin");
  expectFresh(() => chapter.begin({ chapterOneChoice: "publish" }), "chapter begin");
  expectFresh(() => chapter.update(0.125), "positive-time dialogue tick");
  expectFresh(() => chapter.advanceLine(), "manual dialogue advance");

  const beforeDrain = previous;
  assert.ok(chapter.drainEvents().length > 0);
  const afterDrain = chapter.snapshot();
  assert.notStrictEqual(afterDrain, beforeDrain, "draining the observable event queue invalidates publication identity");
  assert.strictEqual(chapter.snapshot(), afterDrain);
  previous = afterDrain;

  const sameStateSave = chapter.save();
  expectFresh(() => chapter.restore(sameStateSave), "same-state restore");
  expectFresh(() => chapter.restore(initialSave), "restore used as reset");
  assert.equal(previous.phase, CHAPTER_TWO_PHASES.LOCKED);

  const decision = reachDecision("protect");
  const beforeChoice = decision.snapshot();
  const consequence = decision.choose("recall_then_report");
  assert.notStrictEqual(consequence, beforeChoice, "a moral choice must invalidate the decision snapshot");
  assert.strictEqual(decision.snapshot(), consequence);
  assert.ok(Object.isFrozen(consequence.line));
});

test("RAM-only prewarm touches every dialogue and branch state without mutating state or queued events", () => {
  const warmed = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  const control = createBorrowedTimeChapter({ autoBegin: true, chapterOneChoice: "publish" });
  warmed.update(0.75);
  control.update(0.75);
  const before = warmed.save();
  const beforeSnapshot = warmed.snapshot();

  const result = warmed.prewarm();
  assert.deepEqual(warmed.save(), before);
  assert.notStrictEqual(warmed.snapshot(), beforeSnapshot, "prewarm's internal restore cycle must invalidate the publication cache");
  assert.deepEqual(warmed.drainEvents(), control.drainEvents(), "prewarm must preserve pending one-shot events exactly");
  assert.equal(result.ready, true);
  assert.equal(result.storage, "memory-only");
  assert.equal(result.rendererResources, 0);
  assert.equal(result.sequencesPrepared, 11);
  assert.equal(result.sequencesPrepared, Object.keys(CHAPTER_TWO_SEQUENCES).length);
  assert.equal(result.dialogueLinesPrepared, 47);
  assert.equal(result.dialogueLinesPrepared, Object.values(CHAPTER_TWO_SEQUENCES).reduce((sum, sequence) => sum + sequence.lines.length, 0));
  assert.equal(result.clueStatesPrepared, 3);
  assert.equal(result.priorChoiceStatesPrepared, 2);
  assert.equal(result.branchStatesPrepared, 2);
  assert.equal(result.aftermathHooksPrepared, 2);
  assert.equal(result.aftermathEpiloguesPrepared, 2);
});
