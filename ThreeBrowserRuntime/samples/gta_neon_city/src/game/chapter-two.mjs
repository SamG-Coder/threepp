export const CHAPTER_TWO_SAVE_VERSION = 2;

export const CHAPTER_TWO_PHASES = Object.freeze({
  LOCKED: "locked",
  OPENING: "opening",
  INVESTIGATE_GARAGE: "investigate_garage",
  SPEAK_TO_LEAH: "speak_to_leah",
  INSPECT_DEPOT: "inspect_depot",
  DECISION: "decision",
  CONSEQUENCE: "consequence",
  COMPLETE: "complete",
});

export const CHAPTER_TWO = Object.freeze({
  number: 2,
  id: "borrowed_time",
  title: "BORROWED TIME",
  subtitle: "WHEN A DELAY BECOMES A DECISION",
});

const PRIOR_CHOICES = Object.freeze(["publish", "protect"]);
const LEDGER_KEYS = Object.freeze([
  "knownDriversProtected",
  "unknownDriversAtRisk",
  "evidenceAtRisk",
  "peoplePubliclyExposed",
  "garageSuspensionDays",
  "vossLeadHours",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function line(speaker, text, options = {}) {
  return deepFreeze({
    speaker,
    text,
    shot: options.shot ?? "conversation",
    duration: options.duration ?? 4.4,
    radio: options.radio === true,
  });
}

const FAILURE_INCIDENT_LINES = Object.freeze([
  line("LEAH / PHONE", "Kai? My brake pedal dropped at Mercer and Fifth. I stopped on the handbrake against the curb. Nobody is hurt, but I am not driving it another metre.", { shot: "phone", radio: true, duration: 6.4 }),
  line("KAI", "Stay with the car until the tow arrives. Leave the keys with the driver and do not let anyone else move it. I will check every hose from that batch.", { shot: "phone", radio: true, duration: 5.8 }),
  line("JUNO", "Kai, wait. The hose was marked S-17. The invoice said S-71. I noticed when the box came in.", { shot: "garage_close", duration: 5.0 }),
  line("KAI", "You noticed?", { shot: "kai_close", duration: 2.2 }),
  line("JUNO", "Tuesday. Four customers were waiting, rent was due, and the account had six hundred dollars left. I kept reading the one as a seven because sending the box back might finish us.", { shot: "garage_close", duration: 6.8 }),
]);

const FAILURE_ACCOUNTABILITY_LINES = Object.freeze([
  line("KAI", "That tells me why you did it. It does not make Leah's car safe.", { shot: "two_shot", duration: 4.5 }),
  line("JUNO", "I know. Take the failed hose, the invoice, and my service log. Put down why I did it, but do not clean up my part.", { shot: "evidence_table", duration: 5.4 }),
]);

export const CHAPTER_TWO_SEQUENCES = deepFreeze({
  failure_after_publish: {
    id: "failure_after_publish",
    titleCard: "CHAPTER TWO / BORROWED TIME",
    cinematic: true,
    controlsLocked: true,
    lines: [
      ...FAILURE_INCIDENT_LINES,
      line("RIN / PHONE", "Last time, we went public before we could protect everyone. We said delay was also harm. Being family does not buy Pulse a different rule.", { shot: "phone", radio: true, duration: 6.0 }),
      ...FAILURE_ACCOUNTABILITY_LINES,
    ],
  },
  failure_after_protect: {
    id: "failure_after_protect",
    titleCard: "CHAPTER TWO / BORROWED TIME",
    cinematic: true,
    controlsLocked: true,
    lines: [
      ...FAILURE_INCIDENT_LINES,
      line("RIN / PHONE", "Last time, we held names back because those people never chose the risk. Leah never chose this one. Protecting people cannot mean protecting Pulse from what it did.", { shot: "phone", radio: true, duration: 6.4 }),
      ...FAILURE_ACCOUNTABILITY_LINES,
    ],
  },
  failed_brake_hose: {
    id: "failed_brake_hose",
    // These are deliberately short, skippable insert shots. The lock lasts
    // only for the two authored lines, then inspection returns to play.
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("KAI", "No scrape on the outside. The inner braid split under pressure. Lot stamp S-17. The curb did not cause this.", { shot: "evidence_hose", duration: 5.2 }),
      line("JUNO", "So it was not anything Leah did. Write down exactly what you found.", { shot: "evidence_hose", duration: 4.4 }),
    ],
  },
  supplier_invoice: {
    id: "supplier_invoice",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("KAI", "Southline charged us for certified S-71 assemblies. The receiving scan says S-17. Nobody attached a correction.", { shot: "evidence_invoice", duration: 5.3 }),
      line("JUNO", "I signed for it. Put down why I did, but do not let me use the reason as an excuse.", { shot: "juno_close", duration: 4.8 }),
    ],
  },
  service_log: {
    id: "service_log",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("KAI", "Eleven cars received hoses from this batch. Seven owners are named. Four were fleet jobs with the driver fields stripped out.", { shot: "evidence_log", duration: 5.6 }),
      line("JUNO", "Seven people we can call tonight. Four people hidden behind fleet numbers.", { shot: "evidence_log", duration: 4.3 }),
    ],
  },
  leah_account: {
    id: "leah_account",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("LEAH", "I do home care at night. Two of my clients cannot take a bus, so I took my car to the garage I could afford. That should not mean gambling on the brakes.", { shot: "cafe_two_shot", duration: 6.0 }),
      line("KAI", "You did not gamble. We did. Juno saw the mismatch, and Pulse fitted the part anyway. Tell me the time, the route, and what the pedal did.", { shot: "kai_close", duration: 5.8 }),
      line("LEAH", "I will tell you everything. But do not put me in an apology as 'the brave customer.' Find the other cars.", { shot: "leah_close", duration: 5.2 }),
      line("KAI", "Eleven cars. Seven owners we can call. The other four came through Southline fleet accounts. That is where I am going.", { shot: "cafe_two_shot", duration: 5.0 }),
    ],
  },
  depot_manifest: {
    id: "depot_manifest",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("KAI", "I have a clear photo. S-17 stock was relabelled S-71 under a Voss freight authorization. The same pallet went to three districts.", { shot: "manifest_close", duration: 5.7 }),
      line("RIN / PHONE", "File now and the regulator can freeze Southline and order a public recall. The emergency case needs Pulse's full service ledger to reach the unknown drivers. Workers and customers lose their privacy, and the garage closes during the investigation.", { shot: "phone", radio: true, duration: 7.2 }),
      line("RIN / PHONE", "Or call the seven named drivers first, then file within six hours. They can park their cars and prepare for their names to enter the case. But four drivers get no warning, and Voss gets six hours alone with the original manifest.", { shot: "phone", radio: true, duration: 7.2 }),
      line("KAI", "There is no clean order. I can warn everyone by exposing people who trusted us without warning, or give seven people time to prepare while four strangers keep driving. Either way, somebody pays for our delay.", { shot: "depot_wide", duration: 6.7 }),
    ],
  },
  report_now: {
    id: "report_now",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("KAI", "I am filing now. Send the manifest, all eleven service entries, and Juno's receiving note. No redactions just because Pulse is ours.", { shot: "phone", radio: true, duration: 5.3 }),
      line("RIN / PHONE", "The depot is frozen. The recall is public. Inspectors have sealed Pulse Garage for thirty days while they trace the batch.", { shot: "phone", radio: true, duration: 5.8 }),
      line("LEAH / PHONE", "My employer called before the tow truck got here. My name was beside the fraud notice. He asked if I had brought a dangerous car to a client's home.", { shot: "phone", radio: true, duration: 6.0 }),
      line("KAI", "The notice may reach the four drivers we cannot name. But it put your work and your name in public before you had any say. I will not ask you to call that fair.", { shot: "kai_close", duration: 6.3 }),
      line("JUNO", "The suspension is on me. But do not call this justice and go home. The mechanics did not approve that box, and our customers still need rides. We help them now.", { shot: "sealed_garage", duration: 6.2 }),
    ],
  },
  recall_then_report: {
    id: "recall_then_report",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("KAI", "Seven calls, seven cars parked. File it now. Include the contact log, and do not write a line pretending the other four are safe.", { shot: "recall_board", duration: 5.5 }),
      line("RIN / PHONE", "Filed. Southline's loading bay was empty when inspectors arrived. Voss had six hours; the original manifest is gone, but your photograph remains.", { shot: "phone", radio: true, duration: 6.2 }),
      line("JUNO", "We parked the seven cars we could name. Now those names are in the filing, the other four are still missing, and Pulse is closed anyway.", { shot: "juno_close", duration: 5.5 }),
      line("KAI", "I put the people I could name first. Knowing their names made them easier to help, not more valuable. We keep looking until the fleet numbers belong to people.", { shot: "sealed_garage", duration: 6.2 }),
    ],
  },
  open_ledger_epilogue: {
    id: "open_ledger_epilogue",
    titleCard: "AFTERMATH / THE OPEN LEDGER",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("MARA", "The recall stopped me driving a van whose brakes might fail. The notice also put my name beside 'fraud' before anyone called.", { shot: "recall_customer_close", duration: 6.2 }),
      line("KAI", "The warning protected your body and spent your name. I will not pretend one cancels the other.", { shot: "kai_recall_close", duration: 5.2 }),
      line("LEAH", "Then do not. Log the lost shift, fix the van, and call the next person before the notice does.", { shot: "leah_recall_close", duration: 5.2 }),
      line("JUNO", "Pulse is closed. The support desk stays open.", { shot: "sealed_garage", duration: 3.8 }),
    ],
  },
  missing_four_epilogue: {
    id: "missing_four_epilogue",
    titleCard: "AFTERMATH / THE MISSING FOUR",
    cinematic: true,
    controlsLocked: true,
    lines: [
      line("DARA", "This carbon copy turns fleet 44B into Arturo Reyes, night sanitation. Three rows are still blank.", { shot: "dara_records_close", duration: 5.6 }),
      line("KAI", "Knowing one name makes one person reachable. It does not make the three we cannot name worth less.", { shot: "kai_depot_close", duration: 5.4 }),
      line("RIN / PHONE", "The photograph held; the original is gone. We search dispatch rosters before another shift changes.", { shot: "phone", radio: true, duration: 5.3 }),
      line("JUNO", "Pulse stays closed while we do it. Accountability is not a door we reopen because we became useful.", { shot: "sealed_garage", duration: 5.6 }),
    ],
  },
});

export const CHAPTER_TWO_CLUES = deepFreeze([
  {
    id: "failed_brake_hose",
    label: "FAILED BRAKE HOSE",
    kind: "inspect",
    targetKey: "pulse_garage_failed_hose",
    sequenceId: "failed_brake_hose",
  },
  {
    id: "supplier_invoice",
    label: "SUPPLIER INVOICE",
    kind: "inspect",
    targetKey: "pulse_garage_supplier_invoice",
    sequenceId: "supplier_invoice",
  },
  {
    id: "service_log",
    label: "SERVICE LOG",
    kind: "inspect",
    targetKey: "pulse_garage_service_log",
    sequenceId: "service_log",
  },
]);

export const CHAPTER_TWO_AFFECTED_PERSON = deepFreeze({
  id: "leah_moreno",
  name: "LEAH MORENO",
  role: "OVERNIGHT HOME-CARE WORKER AND PULSE CUSTOMER",
  targetKey: "common_ground_leah",
});

export const CHAPTER_TWO_AFTERMATH_HOOKS = deepFreeze({
  report_now: {
    id: "open_ledger",
    title: "THE OPEN LEDGER",
    kind: "recall_support",
    targetKey: "pulse_garage_recall_desk",
    objective: "KEEP THE SEALED GARAGE'S RECALL DESK RUNNING",
    description: "Arrange safe transport and verify recall notices without approaching witnesses. Pulse workers have no shifts, and named customers are fielding calls from employers and families.",
    unresolvedCost: "The public recall may find unknown drivers, but people already attached to the ledger lose control of their names.",
  },
  recall_then_report: {
    id: "the_missing_four",
    title: "THE MISSING FOUR",
    kind: "fleet_trace",
    targetKey: "southline_fleet_records",
    objective: "TURN FOUR FLEET NUMBERS INTO DRIVER NAMES",
    description: "Trace the subcontract routes and preserve a second copy of Southline's records after Voss moved the original manifest.",
    unresolvedCost: "Seven known drivers are parked; four unknown drivers may still be using the defective batch.",
  },
});

const AFTERMATH_EPILOGUE_BY_HOOK_ID = deepFreeze({
  open_ledger: "open_ledger_epilogue",
  the_missing_four: "missing_four_epilogue",
});
const AFTERMATH_HOOK_IDS = new Set(Object.values(CHAPTER_TWO_AFTERMATH_HOOKS).map(hook => hook.id));
const AFTERMATH_EPILOGUE_SEQUENCE_IDS = new Set(Object.values(AFTERMATH_EPILOGUE_BY_HOOK_ID));

export const CHAPTER_TWO_CHOICE = deepFreeze({
  id: "brake_hose_response",
  // Render-only presentation metadata. This is intentionally outside the
  // options and save ledger: the decision and both consequences stay exact.
  cameraShot: "depot_choice",
  prompt: "WHEN DOES KAI REPORT THE DEFECT?",
  context: "An immediate, unredacted filing can reach all eleven drivers, but puts the garage's people into a public case without warning. Calling seven known drivers first lets them park and prepare before filing, while four unknown drivers go unwarned and Voss gets six hours with the evidence.",
  options: [
    {
      id: "report_now",
      label: "REPORT NOW",
      summary: "PUBLIC RECALL; FREEZE THE EVIDENCE; EXPOSE THE GARAGE'S PEOPLE",
      sequenceId: "report_now",
      aftermathHookId: "open_ledger",
      ledger: {
        knownDriversProtected: 11,
        unknownDriversAtRisk: 0,
        evidenceAtRisk: 0,
        peoplePubliclyExposed: 11,
        garageSuspensionDays: 30,
        vossLeadHours: 0,
      },
    },
    {
      id: "recall_then_report",
      label: "RECALL SEVEN, THEN REPORT",
      summary: "PARK KNOWN CARS; RISK FOUR UNKNOWN DRIVERS AND A SIX-HOUR EVIDENCE WINDOW",
      sequenceId: "recall_then_report",
      aftermathHookId: "the_missing_four",
      ledger: {
        knownDriversProtected: 7,
        unknownDriversAtRisk: 4,
        evidenceAtRisk: 1,
        peoplePubliclyExposed: 7,
        garageSuspensionDays: 30,
        vossLeadHours: 6,
      },
    },
  ],
});

const EMPTY_LEDGER = deepFreeze(Object.fromEntries(LEDGER_KEYS.map(key => [key, 0])));
const PHASE_VALUES = new Set(Object.values(CHAPTER_TWO_PHASES));
const SEQUENCE_IDS = new Set(Object.keys(CHAPTER_TWO_SEQUENCES));
const CLUE_BY_ID = new Map(CHAPTER_TWO_CLUES.map(clue => [clue.id, clue]));
const OPTION_BY_ID = new Map(CHAPTER_TWO_CHOICE.options.map(option => [option.id, option]));

function createInitialSave() {
  return {
    version: CHAPTER_TWO_SAVE_VERSION,
    phase: CHAPTER_TWO_PHASES.LOCKED,
    chapterStarted: false,
    chapterCompleted: false,
    chapterOneChoice: null,
    activeSequenceId: null,
    lineIndex: 0,
    lineElapsed: 0,
    elapsed: 0,
    sequenceSerial: 0,
    eventSerial: 0,
    activeChoiceId: null,
    choiceResult: null,
    inspectedClues: [],
    affectedPersonSpoken: false,
    manifestMethod: null,
    moralLedger: { ...EMPTY_LEDGER },
    aftermathEpilogueStartedId: null,
    aftermathEpilogueCompletedId: null,
    completedSequences: [],
    lastEvent: "waiting_for_chapter_one_choice",
  };
}

function cloneLedger(ledger) {
  return Object.fromEntries(LEDGER_KEYS.map(key => [key, ledger[key]]));
}

function assertPlainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number`);
}

function assertIntegerNonNegative(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
}

function assertUniqueKnownArray(value, known, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) throw new RangeError(`${label} contains unknown id: ${item}`);
    if (unique.has(item)) throw new RangeError(`${label} contains duplicate id: ${item}`);
    unique.add(item);
  }
  return unique;
}

function normalizePriorChoice(context) {
  if (typeof context === "string") return context;
  if (!context || typeof context !== "object") return null;
  return context.chapterOneChoice ?? context.choiceResult ?? context.choice ?? null;
}

export function createBorrowedTimeChapter({ autoBegin = false, chapterOneChoice = null } = {}) {
  let phase = CHAPTER_TWO_PHASES.LOCKED;
  let chapterStarted = false;
  let chapterCompleted = false;
  let priorChoice = null;
  let activeSequence = null;
  let lineIndex = 0;
  let lineElapsed = 0;
  let elapsed = 0;
  let sequenceSerial = 0;
  let eventSerial = 0;
  let activeChoice = null;
  let choiceResult = null;
  let inspectedClues = new Set();
  let affectedPersonSpoken = false;
  let manifestMethod = null;
  let moralLedger = cloneLedger(EMPTY_LEDGER);
  let aftermathEpilogueStartedId = null;
  let aftermathEpilogueCompletedId = null;
  let completedSequences = new Set();
  let lastEvent = "waiting_for_chapter_one_choice";
  const emitted = [];
  let stateRevision = 0;
  let cachedSnapshotRevision = -1;
  let cachedSnapshot = null;

  function invalidateSnapshot() {
    if (stateRevision === Number.MAX_SAFE_INTEGER) {
      // A wrap is practically unreachable, but explicitly evict the cache so
      // revision equality can never resurrect a stale snapshot.
      stateRevision = 0;
      cachedSnapshotRevision = -1;
      cachedSnapshot = null;
      return;
    }
    stateRevision += 1;
  }

  function emit(type, payload = {}) {
    eventSerial += 1;
    emitted.push(deepFreeze({ type, eventSerial, ...payload }));
    invalidateSnapshot();
  }

  function objectiveState() {
    if (phase === CHAPTER_TWO_PHASES.LOCKED) {
      return { objective: "COMPLETE CHAPTER ONE'S EVIDENCE DECISION", targetKey: null };
    }
    if (phase === CHAPTER_TWO_PHASES.OPENING) {
      return { objective: "HEAR WHAT HAPPENED TO LEAH'S BRAKES", targetKey: "pulse_garage_evidence_bay" };
    }
    if (phase === CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE) {
      const remaining = CHAPTER_TWO_CLUES.filter(clue => !inspectedClues.has(clue.id));
      return {
        objective: `INSPECT THE HOSE, INVOICE, AND SERVICE LOG (${inspectedClues.size}/3)`,
        targetKey: remaining[0]?.targetKey ?? "pulse_garage_evidence_bay",
      };
    }
    if (phase === CHAPTER_TWO_PHASES.SPEAK_TO_LEAH) {
      return { objective: "SPEAK TO LEAH MORENO AT COMMON GROUND", targetKey: CHAPTER_TWO_AFFECTED_PERSON.targetKey };
    }
    if (phase === CHAPTER_TWO_PHASES.INSPECT_DEPOT) {
      return { objective: "PHOTOGRAPH OR INSPECT SOUTHLINE'S PARTS MANIFEST", targetKey: "southline_parts_depot_manifest" };
    }
    if (phase === CHAPTER_TWO_PHASES.DECISION) {
      return { objective: "DECIDE WHEN TO REPORT THE DEFECT", targetKey: "southline_parts_depot_manifest" };
    }
    if (phase === CHAPTER_TWO_PHASES.CONSEQUENCE) {
      return { objective: choiceResult === "report_now" ? "FACE THE COST OF THE PUBLIC RECALL" : "FILE AFTER THE SIX-HOUR RECALL", targetKey: "pulse_garage_recall_desk" };
    }
    const hook = choiceResult ? CHAPTER_TWO_AFTERMATH_HOOKS[choiceResult] : null;
    return { objective: hook?.objective ?? "BORROWED TIME COMPLETE", targetKey: hook?.targetKey ?? null };
  }

  function currentLine() {
    return activeSequence?.lines[lineIndex] ?? null;
  }

  function currentHook() {
    return choiceResult ? CHAPTER_TWO_AFTERMATH_HOOKS[choiceResult] ?? null : null;
  }

  function snapshot() {
    if (cachedSnapshot && cachedSnapshotRevision === stateRevision) return cachedSnapshot;
    const objective = objectiveState();
    const displayedLine = currentLine();
    cachedSnapshot = deepFreeze({
      chapter: CHAPTER_TWO,
      phase,
      chapterStarted,
      chapterCompleted,
      chapterOneChoice: priorChoice,
      active: Boolean(activeSequence || activeChoice),
      sequenceId: activeSequence?.id ?? null,
      sequenceSerial,
      lineIndex: activeSequence ? lineIndex : null,
      lineCount: activeSequence?.lines.length ?? 0,
      lineElapsed,
      line: displayedLine ? {
        ...displayedLine,
        elapsed: lineElapsed,
        progress: Math.max(0, Math.min(1, lineElapsed / displayedLine.duration)),
      } : null,
      titleCard: activeSequence?.titleCard ?? null,
      cinematic: Boolean(activeSequence?.cinematic || activeChoice),
      controlsLocked: Boolean(activeSequence?.controlsLocked || activeChoice),
      elapsed,
      objective: objective.objective,
      targetKey: objective.targetKey,
      inspectedClues: [...inspectedClues],
      clueProgress: `${inspectedClues.size}/${CHAPTER_TWO_CLUES.length}`,
      affectedPersonSpoken,
      manifestMethod,
      choice: activeChoice ? CHAPTER_TWO_CHOICE : null,
      choiceResult,
      moralLedger: cloneLedger(moralLedger),
      aftermathHook: currentHook(),
      aftermathEpilogue: {
        hookId: aftermathEpilogueStartedId,
        sequenceId: aftermathEpilogueStartedId ? AFTERMATH_EPILOGUE_BY_HOOK_ID[aftermathEpilogueStartedId] : null,
        started: aftermathEpilogueStartedId !== null,
        completed: aftermathEpilogueCompletedId !== null,
      },
      completedSequences: [...completedSequences],
      lastEvent,
    });
    cachedSnapshotRevision = stateRevision;
    return cachedSnapshot;
  }

  function startSequence(sequenceId) {
    const sequence = CHAPTER_TWO_SEQUENCES[sequenceId];
    if (!sequence) throw new RangeError(`Unknown Chapter Two sequence: ${sequenceId}`);
    activeSequence = sequence;
    lineIndex = 0;
    lineElapsed = 0;
    sequenceSerial += 1;
    lastEvent = `sequence_started:${sequenceId}`;
    emit("sequence_started", { sequenceId, sequenceSerial });
    return snapshot();
  }

  function finishSequence() {
    if (!activeSequence) return snapshot();
    const sequenceId = activeSequence.id;
    completedSequences.add(sequenceId);
    activeSequence = null;
    lineIndex = 0;
    lineElapsed = 0;
    lastEvent = `sequence_completed:${sequenceId}`;
    emit("sequence_completed", { sequenceId, sequenceSerial });

    if (sequenceId === "failure_after_publish" || sequenceId === "failure_after_protect") {
      phase = CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE;
      emit("objective_changed", objectiveState());
    } else if (CLUE_BY_ID.has(sequenceId)) {
      phase = inspectedClues.size === CHAPTER_TWO_CLUES.length
        ? CHAPTER_TWO_PHASES.SPEAK_TO_LEAH
        : CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE;
      emit("objective_changed", objectiveState());
    } else if (sequenceId === "leah_account") {
      phase = CHAPTER_TWO_PHASES.INSPECT_DEPOT;
      emit("objective_changed", objectiveState());
    } else if (sequenceId === "depot_manifest") {
      phase = CHAPTER_TWO_PHASES.DECISION;
      activeChoice = CHAPTER_TWO_CHOICE;
      emit("choice_requested", { choiceId: CHAPTER_TWO_CHOICE.id });
    } else if (sequenceId === "report_now" || sequenceId === "recall_then_report") {
      phase = CHAPTER_TWO_PHASES.COMPLETE;
      chapterCompleted = true;
      const hook = currentHook();
      emit("chapter_completed", {
        chapterId: CHAPTER_TWO.id,
        choiceResult,
        moralLedger: deepFreeze(cloneLedger(moralLedger)),
      });
      emit("aftermath_unlocked", { hook });
    } else if (AFTERMATH_EPILOGUE_SEQUENCE_IDS.has(sequenceId)) {
      const hook = currentHook();
      aftermathEpilogueCompletedId = hook?.id ?? aftermathEpilogueStartedId;
      lastEvent = `aftermath_epilogue_completed:${aftermathEpilogueCompletedId}`;
      emit("aftermath_epilogue_completed", {
        chapterId: CHAPTER_TWO.id,
        choiceResult,
        hookId: aftermathEpilogueCompletedId,
        sequenceId,
      });
    }
    return snapshot();
  }

  function begin(context = {}) {
    if (chapterStarted) return snapshot();
    const resolvedChoice = normalizePriorChoice(context);
    if (!PRIOR_CHOICES.includes(resolvedChoice)) {
      lastEvent = "chapter_one_choice_required";
      invalidateSnapshot();
      return snapshot();
    }
    chapterStarted = true;
    priorChoice = resolvedChoice;
    phase = CHAPTER_TWO_PHASES.OPENING;
    lastEvent = `chapter_started:${resolvedChoice}`;
    emit("chapter_started", {
      chapterId: CHAPTER_TWO.id,
      chapterOneChoice: resolvedChoice,
    });
    return startSequence(resolvedChoice === "publish" ? "failure_after_publish" : "failure_after_protect");
  }

  function inspect(clueId) {
    const clue = CLUE_BY_ID.get(clueId);
    if (!clue) throw new RangeError(`Unknown Chapter Two clue: ${clueId}`);
    if (activeSequence || activeChoice || phase !== CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE) {
      lastEvent = `inspection_blocked:${clueId}`;
      invalidateSnapshot();
      return snapshot();
    }
    if (inspectedClues.has(clueId)) {
      lastEvent = `clue_already_inspected:${clueId}`;
      invalidateSnapshot();
      return snapshot();
    }
    inspectedClues.add(clueId);
    lastEvent = `clue_recorded:${clueId}`;
    emit("clue_recorded", {
      clueId,
      count: inspectedClues.size,
      total: CHAPTER_TWO_CLUES.length,
    });
    return startSequence(clue.sequenceId);
  }

  function speak(personId = CHAPTER_TWO_AFFECTED_PERSON.id) {
    if (activeSequence || activeChoice || phase !== CHAPTER_TWO_PHASES.SPEAK_TO_LEAH) {
      lastEvent = `conversation_blocked:${personId}`;
      invalidateSnapshot();
      return snapshot();
    }
    if (personId !== CHAPTER_TWO_AFFECTED_PERSON.id) throw new RangeError(`Unknown Chapter Two affected person: ${personId}`);
    if (affectedPersonSpoken) return snapshot();
    affectedPersonSpoken = true;
    lastEvent = `affected_person_spoken:${personId}`;
    emit("affected_person_spoken", { personId });
    return startSequence("leah_account");
  }

  function recordManifest(method = "photograph") {
    if (method !== "photograph" && method !== "inspect") throw new RangeError(`Unknown manifest evidence method: ${method}`);
    if (activeSequence || activeChoice || phase !== CHAPTER_TWO_PHASES.INSPECT_DEPOT) {
      lastEvent = `manifest_blocked:${method}`;
      invalidateSnapshot();
      return snapshot();
    }
    if (manifestMethod) return snapshot();
    manifestMethod = method;
    lastEvent = `manifest_recorded:${method}`;
    emit("manifest_recorded", { method, depotId: "southline_parts_depot" });
    return startSequence("depot_manifest");
  }

  function choose(optionId) {
    if (!activeChoice || phase !== CHAPTER_TWO_PHASES.DECISION) {
      lastEvent = `choice_blocked:${optionId}`;
      invalidateSnapshot();
      return snapshot();
    }
    const option = OPTION_BY_ID.get(optionId);
    if (!option) throw new RangeError(`Unknown Chapter Two choice: ${optionId}`);
    choiceResult = option.id;
    moralLedger = cloneLedger(option.ledger);
    activeChoice = null;
    phase = CHAPTER_TWO_PHASES.CONSEQUENCE;
    lastEvent = `choice_made:${optionId}`;
    emit("choice_made", {
      choiceId: CHAPTER_TWO_CHOICE.id,
      optionId,
      moralLedger: deepFreeze(cloneLedger(moralLedger)),
      aftermathHookId: option.aftermathHookId,
    });
    return startSequence(option.sequenceId);
  }

  function advanceLine() {
    if (!activeSequence) return snapshot();
    if (lineIndex + 1 < activeSequence.lines.length) {
      lineIndex += 1;
      lineElapsed = 0;
      lastEvent = `line_advanced:${activeSequence.id}:${lineIndex}`;
      invalidateSnapshot();
      return snapshot();
    }
    return finishSequence();
  }

  function update(deltaSeconds = 0, input = {}) {
    assertFiniteNonNegative(deltaSeconds, "Chapter Two deltaSeconds");
    // Match the main campaign's bounded story clock: a runtime hitch must not
    // fast-forward several authored beats on the first recovered frame.
    const delta = Math.min(0.25, deltaSeconds);
    elapsed += delta;
    if (delta > 0) invalidateSnapshot();
    if (!activeSequence) return snapshot();
    if (input.skip === true) return finishSequence();
    lineElapsed += delta;
    const playerAdvanced = input.advance === true && lineElapsed >= 0.32;
    if (playerAdvanced || lineElapsed + 1e-9 >= currentLine().duration) advanceLine();
    return snapshot();
  }

  function beginAftermathEpilogue(event = {}) {
    const hook = currentHook();
    const requestedHookId = String(event.hookId ?? event.activityId ?? event.id ?? "");
    const requestedChapterId = event.chapterId == null ? CHAPTER_TWO.id : String(event.chapterId);
    const requestedChoice = event.choiceId == null ? choiceResult : String(event.choiceId);

    function reject(reason) {
      lastEvent = `aftermath_epilogue_blocked:${reason}${requestedHookId ? `:${requestedHookId}` : ""}`;
      invalidateSnapshot();
      return snapshot();
    }

    if (!chapterCompleted || phase !== CHAPTER_TWO_PHASES.COMPLETE || !hook) return reject("chapter_incomplete");
    if (requestedChapterId !== CHAPTER_TWO.id) return reject("chapter_mismatch");
    if (requestedChoice !== choiceResult) return reject("choice_mismatch");
    if (!requestedHookId || requestedHookId !== hook.id) return reject("hook_mismatch");
    if (aftermathEpilogueStartedId !== null) {
      return reject(aftermathEpilogueCompletedId !== null ? "already_completed" : "already_started");
    }
    if (activeSequence || activeChoice) return reject("narrative_busy");

    const sequenceId = AFTERMATH_EPILOGUE_BY_HOOK_ID[hook.id];
    if (!sequenceId) return reject("sequence_missing");
    aftermathEpilogueStartedId = hook.id;
    emit("aftermath_epilogue_started", {
      chapterId: CHAPTER_TWO.id,
      choiceResult,
      hookId: hook.id,
      sequenceId,
    });
    return startSequence(sequenceId);
  }

  function notify(event = {}) {
    if (!event || typeof event !== "object") return snapshot();
    if (event.type === "chapter_one_completed" || event.type === "chapter_one_choice_made") return begin(event);
    if (event.type === "inspect_garage_clue" || event.type === "inspect_clue") return inspect(event.clueId ?? event.id);
    if (event.type === "speak_affected" || event.type === "speak_to_leah") return speak(event.personId ?? CHAPTER_TWO_AFFECTED_PERSON.id);
    if (event.type === "photograph_depot_manifest" || event.type === "photograph_manifest") return recordManifest("photograph");
    if (event.type === "inspect_depot_manifest" || event.type === "inspect_manifest") return recordManifest("inspect");
    if (event.type === "aftermath_completed") return beginAftermathEpilogue(event);
    return snapshot();
  }

  function drainEvents() {
    if (emitted.length === 0) return [];
    const drained = emitted.splice(0, emitted.length);
    invalidateSnapshot();
    return drained;
  }

  function save() {
    return {
      version: CHAPTER_TWO_SAVE_VERSION,
      phase,
      chapterStarted,
      chapterCompleted,
      chapterOneChoice: priorChoice,
      activeSequenceId: activeSequence?.id ?? null,
      lineIndex,
      lineElapsed,
      elapsed,
      sequenceSerial,
      eventSerial,
      activeChoiceId: activeChoice?.id ?? null,
      choiceResult,
      inspectedClues: [...inspectedClues],
      affectedPersonSpoken,
      manifestMethod,
      moralLedger: cloneLedger(moralLedger),
      aftermathEpilogueStartedId,
      aftermathEpilogueCompletedId,
      completedSequences: [...completedSequences],
      lastEvent,
    };
  }

  function restore(value) {
    assertPlainRecord(value, "Chapter Two save");
    if (value.version === 1) {
      // Version 1 predates playable aftermath epilogues. Its story ledger and
      // completed chapter remain authoritative; both new once-only markers
      // begin empty so loading an old save never invents a completed route.
      value = {
        ...value,
        version: CHAPTER_TWO_SAVE_VERSION,
        aftermathEpilogueStartedId: null,
        aftermathEpilogueCompletedId: null,
      };
    }
    if (value.version !== CHAPTER_TWO_SAVE_VERSION) {
      throw new RangeError(`Unsupported Chapter Two save version: ${value.version}`);
    }
    if (!PHASE_VALUES.has(value.phase)) throw new RangeError(`Unknown Chapter Two phase: ${value.phase}`);
    if (typeof value.chapterStarted !== "boolean" || typeof value.chapterCompleted !== "boolean") {
      throw new TypeError("Chapter Two completion flags must be boolean");
    }
    if (value.chapterOneChoice !== null && !PRIOR_CHOICES.includes(value.chapterOneChoice)) {
      throw new RangeError(`Unknown Chapter One choice: ${value.chapterOneChoice}`);
    }
    if (value.activeSequenceId !== null && !SEQUENCE_IDS.has(value.activeSequenceId)) {
      throw new RangeError(`Unknown active Chapter Two sequence: ${value.activeSequenceId}`);
    }
    assertIntegerNonNegative(value.lineIndex, "Chapter Two lineIndex");
    assertFiniteNonNegative(value.lineElapsed, "Chapter Two lineElapsed");
    assertFiniteNonNegative(value.elapsed, "Chapter Two elapsed");
    assertIntegerNonNegative(value.sequenceSerial, "Chapter Two sequenceSerial");
    assertIntegerNonNegative(value.eventSerial, "Chapter Two eventSerial");
    if (value.activeChoiceId !== null && value.activeChoiceId !== CHAPTER_TWO_CHOICE.id) {
      throw new RangeError(`Unknown active Chapter Two choice: ${value.activeChoiceId}`);
    }
    if (value.choiceResult !== null && !OPTION_BY_ID.has(value.choiceResult)) {
      throw new RangeError(`Unknown Chapter Two choice result: ${value.choiceResult}`);
    }
    const restoredClues = assertUniqueKnownArray(value.inspectedClues, new Set(CLUE_BY_ID.keys()), "Chapter Two inspectedClues");
    if (typeof value.affectedPersonSpoken !== "boolean") throw new TypeError("Chapter Two affectedPersonSpoken must be boolean");
    if (value.manifestMethod !== null && value.manifestMethod !== "photograph" && value.manifestMethod !== "inspect") {
      throw new RangeError(`Unknown Chapter Two manifest method: ${value.manifestMethod}`);
    }
    assertPlainRecord(value.moralLedger, "Chapter Two moralLedger");
    for (const key of LEDGER_KEYS) assertIntegerNonNegative(value.moralLedger[key], `Chapter Two moralLedger.${key}`);
    if (Object.keys(value.moralLedger).length !== LEDGER_KEYS.length) throw new RangeError("Chapter Two moralLedger has unknown or missing fields");
    const restoredCompleted = assertUniqueKnownArray(value.completedSequences, SEQUENCE_IDS, "Chapter Two completedSequences");
    if (value.aftermathEpilogueStartedId !== null && !AFTERMATH_HOOK_IDS.has(value.aftermathEpilogueStartedId)) {
      throw new RangeError(`Unknown started Chapter Two aftermath epilogue: ${value.aftermathEpilogueStartedId}`);
    }
    if (value.aftermathEpilogueCompletedId !== null && !AFTERMATH_HOOK_IDS.has(value.aftermathEpilogueCompletedId)) {
      throw new RangeError(`Unknown completed Chapter Two aftermath epilogue: ${value.aftermathEpilogueCompletedId}`);
    }
    if (value.lastEvent !== null && typeof value.lastEvent !== "string") throw new TypeError("Chapter Two lastEvent must be a string or null");

    const restoredSequence = value.activeSequenceId ? CHAPTER_TWO_SEQUENCES[value.activeSequenceId] : null;
    if (restoredSequence && value.lineIndex >= restoredSequence.lines.length) throw new RangeError("Chapter Two lineIndex exceeds active sequence");
    if (!restoredSequence && value.lineIndex !== 0) throw new RangeError("Chapter Two lineIndex requires an active sequence");
    if (!value.chapterStarted && (value.phase !== CHAPTER_TWO_PHASES.LOCKED || value.chapterOneChoice !== null)) {
      throw new RangeError("A locked Chapter Two save cannot contain started story state");
    }
    if (value.chapterStarted && value.chapterOneChoice === null) throw new RangeError("Started Chapter Two save requires a Chapter One choice");
    if (value.activeChoiceId !== null && value.phase !== CHAPTER_TWO_PHASES.DECISION) {
      throw new RangeError("Active Chapter Two choice requires the decision phase");
    }
    if (value.chapterCompleted && (value.phase !== CHAPTER_TWO_PHASES.COMPLETE || value.choiceResult === null)) {
      throw new RangeError("Completed Chapter Two save requires a completed choice branch");
    }
    if (value.affectedPersonSpoken && restoredClues.size !== CHAPTER_TWO_CLUES.length) {
      throw new RangeError("Leah cannot be recorded before all garage evidence is inspected");
    }
    if (value.manifestMethod !== null && !value.affectedPersonSpoken) {
      throw new RangeError("Depot evidence cannot precede Leah's account");
    }
    if (value.aftermathEpilogueCompletedId !== null && value.aftermathEpilogueCompletedId !== value.aftermathEpilogueStartedId) {
      throw new RangeError("A completed Chapter Two aftermath epilogue requires the matching started hook");
    }
    if (value.aftermathEpilogueStartedId !== null) {
      const expectedHook = value.choiceResult ? CHAPTER_TWO_AFTERMATH_HOOKS[value.choiceResult]?.id : null;
      const expectedSequence = AFTERMATH_EPILOGUE_BY_HOOK_ID[value.aftermathEpilogueStartedId];
      if (!value.chapterCompleted || value.phase !== CHAPTER_TWO_PHASES.COMPLETE || value.aftermathEpilogueStartedId !== expectedHook) {
        throw new RangeError("Chapter Two aftermath epilogue must match the completed moral choice");
      }
      if (value.aftermathEpilogueCompletedId !== null && !restoredCompleted.has(expectedSequence)) {
        throw new RangeError("Completed Chapter Two aftermath epilogue requires its completed sequence");
      }
      if (value.aftermathEpilogueCompletedId === null && value.activeSequenceId !== expectedSequence) {
        throw new RangeError("Started Chapter Two aftermath epilogue requires its active sequence");
      }
    }
    if (value.activeSequenceId && AFTERMATH_EPILOGUE_SEQUENCE_IDS.has(value.activeSequenceId) && value.aftermathEpilogueStartedId === null) {
      throw new RangeError("Active Chapter Two aftermath sequence requires its started hook");
    }

    phase = value.phase;
    chapterStarted = value.chapterStarted;
    chapterCompleted = value.chapterCompleted;
    priorChoice = value.chapterOneChoice;
    activeSequence = restoredSequence;
    lineIndex = value.lineIndex;
    lineElapsed = value.lineElapsed;
    elapsed = value.elapsed;
    sequenceSerial = value.sequenceSerial;
    eventSerial = value.eventSerial;
    activeChoice = value.activeChoiceId ? CHAPTER_TWO_CHOICE : null;
    choiceResult = value.choiceResult;
    inspectedClues = restoredClues;
    affectedPersonSpoken = value.affectedPersonSpoken;
    manifestMethod = value.manifestMethod;
    moralLedger = cloneLedger(value.moralLedger);
    aftermathEpilogueStartedId = value.aftermathEpilogueStartedId;
    aftermathEpilogueCompletedId = value.aftermathEpilogueCompletedId;
    completedSequences = restoredCompleted;
    lastEvent = value.lastEvent;
    emitted.length = 0;
    invalidateSnapshot();
    return snapshot();
  }

  function prewarm() {
    const previousSave = save();
    const previousEvents = emitted.slice();
    const touchedSequences = new Set();
    const touchedBranches = new Set();
    const touchedPriorChoices = new Set();
    let dialogueCharacters = 0;
    let result;

    function consumeActive() {
      while (activeSequence) {
        touchedSequences.add(activeSequence.id);
        dialogueCharacters += currentLine()?.text.length ?? 0;
        advanceLine();
      }
    }

    try {
      for (const previousChoice of PRIOR_CHOICES) {
        for (const branch of CHAPTER_TWO_CHOICE.options) {
          restore(createInitialSave());
          begin({ chapterOneChoice: previousChoice });
          touchedPriorChoices.add(previousChoice);
          consumeActive();
          for (const clue of CHAPTER_TWO_CLUES) {
            inspect(clue.id);
            consumeActive();
          }
          speak(CHAPTER_TWO_AFFECTED_PERSON.id);
          consumeActive();
          recordManifest("photograph");
          consumeActive();
          choose(branch.id);
          touchedBranches.add(branch.id);
          consumeActive();
          const hook = currentHook();
          notify({
            type: "aftermath_completed",
            chapterId: CHAPTER_TWO.id,
            choiceId: branch.id,
            hookId: hook.id,
          });
          consumeActive();
        }
      }
      result = deepFreeze({
        ready: true,
        storage: "memory-only",
        rendererResources: 0,
        sequencesPrepared: touchedSequences.size,
        dialogueLinesPrepared: Object.values(CHAPTER_TWO_SEQUENCES).reduce((total, sequence) => total + sequence.lines.length, 0),
        dialogueCharactersTouched: dialogueCharacters,
        clueStatesPrepared: CHAPTER_TWO_CLUES.length,
        priorChoiceStatesPrepared: touchedPriorChoices.size,
        branchStatesPrepared: touchedBranches.size,
        aftermathHooksPrepared: Object.keys(CHAPTER_TWO_AFTERMATH_HOOKS).length,
        aftermathEpiloguesPrepared: AFTERMATH_EPILOGUE_SEQUENCE_IDS.size,
      });
    } finally {
      restore(previousSave);
      emitted.push(...previousEvents);
      if (previousEvents.length > 0) invalidateSnapshot();
    }
    return result;
  }

  if (autoBegin) begin({ chapterOneChoice });

  return Object.freeze({
    begin,
    notify,
    inspect,
    speak,
    recordManifest,
    update,
    advanceLine,
    choose,
    drainEvents,
    save,
    restore,
    snapshot,
    prewarm,
  });
}
