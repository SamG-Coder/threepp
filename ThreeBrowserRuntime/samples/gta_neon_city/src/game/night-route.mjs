import { LIFE_ACTIVITY_DEFINITIONS } from "./life-activities.mjs";
import { DEFAULT_NEIGHBOURHOOD_BUSINESSES } from "./neighbourhood-routine.mjs";

export const NIGHT_ROUTE_SAVE_VERSION = 1;

export const NIGHT_ROUTE_PHASES = Object.freeze({
  LOCKED: "locked",
  BRIEFING: "briefing",
  SURVEY: "survey",
  DECISION: "decision",
  AFTERMATH: "aftermath",
  COMPLETE: "complete",
});

const EMPTY_EVENTS = Object.freeze([]);
const LEDGER_KEYS = Object.freeze([
  "serviceDaysSecured",
  "fullTimetableMonths",
  "publicRiderRecords",
  "lateRunsCut",
  "weeklyCountingHours",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
}

function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}

function point(value, fallback = [0, 0, 0]) {
  const source = value?.position ?? value ?? fallback;
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    return Object.freeze([finite(source[0]), finite(source[1]), finite(source[2])]);
  }
  return Object.freeze([finite(source?.x), finite(source?.y), finite(source?.z)]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function squaredDistance(first, second) {
  const dx = first[0] - second[0];
  const dz = first[2] - second[2];
  return dx * dx + dz * dz;
}

function requireDefinition(values, id, label) {
  const definition = values.find(entry => entry.id === id);
  if (!definition) throw new Error(`Night Route requires ${label}: ${id}`);
  return definition;
}

const PULSE_LINE = requireDefinition(LIFE_ACTIVITY_DEFINITIONS, "pulse_line", "life activity");
const NEIGHBOURHOOD_HANDS = requireDefinition(LIFE_ACTIVITY_DEFINITIONS, "neighbourhood_hands", "life activity");
const SOUTHLINE_DINER = requireDefinition(DEFAULT_NEIGHBOURHOOD_BUSINESSES, "southline_diner", "business");
const SOUTHLINE_BUSINESS_INDEX = DEFAULT_NEIGHBOURHOOD_BUSINESSES.indexOf(SOUTHLINE_DINER);

export const NIGHT_ROUTE_ANCHORS = deepFreeze({
  southlineDiner: SOUTHLINE_DINER.position,
  pulseStation: PULSE_LINE.stops[0].position,
  civicPlaza: PULSE_LINE.stops[1].position,
  westsideClinic: PULSE_LINE.stops[3].position,
  communityNoticeboard: NEIGHBOURHOOD_HANDS.hub,
});

export const NIGHT_ROUTE_STORY = deepFreeze({
  id: "the_night_count",
  title: "THE NIGHT COUNT",
  subtitle: "WHO GETS COUNTED WHEN THE MACHINE FAILS",
  kind: "ordinary_story",
  primaryPath: "peaceful",
  hubLabel: "SOUTHLINE DINER — ROUTE MEETING",
  hubPosition: NIGHT_ROUTE_ANCHORS.southlineDiner,
});

export const NIGHT_ROUTE_REQUIREMENTS = deepFreeze({
  lifeActivitiesCompleted: 2,
  taxiFaresCompleted: 1,
  southlineFamiliarity: 2,
});

export const NIGHT_ROUTE_CHARACTERS = deepFreeze({
  kai: {
    id: "kai",
    name: "KAI",
    role: "PULSE GARAGE DRIVER AND SOUTHLINE REGULAR",
  },
  rosa: {
    id: "rosa_alvarez",
    name: "ROSA ALVAREZ",
    role: "SOUTHLINE DINER OWNER",
  },
  malik: {
    id: "malik_reed",
    name: "MALIK REED",
    role: "NIGHT ROUTE DRIVER",
  },
  evelyn: {
    id: "evelyn_cho",
    name: "EVELYN CHO",
    role: "CITY TRANSIT AUDITOR",
  },
  desmond: {
    id: "desmond_vale",
    name: "DESMOND VALE",
    role: "OVERNIGHT HOSPITAL PORTER AND RIDER",
  },
  nadiya: {
    id: "nadiya_khoury",
    name: "NADIYA KHOURY",
    role: "CONTRACT LAUNDRY WORKER AND RIDER",
  },
});

function spoken(characterKey, text, duration = 4.8) {
  const character = NIGHT_ROUTE_CHARACTERS[characterKey];
  if (!character) throw new RangeError(`Unknown Night Route character: ${characterKey}`);
  return deepFreeze({
    speaker: character.name,
    role: character.role,
    text: String(text),
    duration: Math.max(0.1, finite(duration, 4.8)),
  });
}

function sequence(id, blocking, lines) {
  return deepFreeze({ id, blocking: Boolean(blocking), lines });
}

export const NIGHT_ROUTE_SEQUENCES = deepFreeze({
  briefing: sequence("briefing", true, [
    spoken("rosa", "You have worked city jobs, taken fares after midnight, and sat at this counter often enough to know who is still awake at two. I am asking because you know the route—not because dinner put you in my debt.", 7.2),
    spoken("malik", "The city's Tuesday sheet says eight riders. The Pulse Station validator failed before my first run. Everyone who paid cash became an empty seat.", 6.2),
    spoken("evelyn", "I believe the reader failed. The annual audit cannot fund a route on my belief. An anonymous manual count buys sixty trial nights. Five signed work-pattern affidavits meet the rule for a full year.", 7.2),
    spoken("kai", "Then we count first. Nobody signs away a piece of their life before they hear the price.", 4.8),
  ]),
  pulse_station_count: sequence("pulse_station_count", false, [
    spoken("malik", "Write eighteen at Pulse, including the three the validator missed. A broken reader is a maintenance fault, not a demographic.", 5.8),
    spoken("kai", "Eighteen bodies. No names.", 2.8),
  ]),
  civic_count: sequence("civic_count", false, [
    spoken("desmond", "I can say that I ride. I will not give procurement my ward and shift. My supervisor already treats a late bus like a character flaw.", 6.0),
    spoken("kai", "For the count, you are one rider at Civic. Nothing else.", 3.4),
  ]),
  clinic_count: sequence("clinic_count", false, [
    spoken("nadiya", "The route gets me home in forty minutes. Without it, ninety. I might sign for a year of service. Do not write that as free consent.", 6.2),
    spoken("kai", "If we use affidavits, the condition goes beside the signature.", 3.4),
  ]),
  diner_count: sequence("diner_count", false, [
    spoken("rosa", "Four runs, fifty-three boardings. My kitchen keeps twenty of them fed, so I benefit from this route. Put that conflict in the packet.", 6.0),
    spoken("kai", "The count includes who collected it and who gains.", 3.2),
  ]),
  evidence_decision: sequence("evidence_decision", true, [
    spoken("evelyn", "The anonymous sheet is enough for sixty nights while we repair the validator. Friday late and Sunday late stay cut. After sixty, the route faces audit again.", 6.6),
    spoken("malik", "Two cuts are two driver shifts. Riders keep their schedules private.", 4.0),
    spoken("evelyn", "Five informed affidavits fund the full timetable for a year. Names, employer bands, and travel windows enter the public contract.", 6.2),
    spoken("nadiya", "I will sign if that is the choice. Needing the bus does not make the pressure disappear.", 4.6),
    spoken("kai", "A secure route bought with exposed lives, or a private count that leaves the route temporary. We state the cost either way.", 5.4),
  ]),
  choose_anonymous_trial: sequence("choose_anonymous_trial", true, [
    spoken("kai", "File the anonymous count. Put the missing runs and the sixty-night expiry in the first paragraph.", 4.8),
    spoken("evelyn", "I will authorize the trial. I will not describe it as permanent.", 3.8),
    spoken("malik", "Then we spend sixty nights proving a machine was wrong.", 3.8),
  ]),
  choose_signed_year: sequence("choose_signed_year", true, [
    spoken("kai", "Use only five people who heard the disclosure and still consented. Put their objections beside their names.", 5.0),
    spoken("evelyn", "The audit will fund twelve months. The records will be public.", 3.8),
    spoken("nadiya", "Then do not call our signatures enthusiasm. Call them the price the rule demanded.", 4.4),
  ]),
  anonymous_file: sequence("anonymous_file", false, [
    spoken("evelyn", "Stamped: sixty nights, anonymous count, full weekday service. The two late weekend runs remain outside funding.", 5.2),
    spoken("kai", "Give me the rejection code for those runs. 'Low use' is not evidence when the reader was dead.", 4.8),
  ]),
  anonymous_timetable: sequence("anonymous_timetable", false, [
    spoken("malik", "This timetable saves the route and cuts my Sunday. Both fit on the same page.", 4.4),
    spoken("kai", "Then both stay on the page.", 2.6),
  ]),
  anonymous_diner: sequence("anonymous_diner", false, [
    spoken("rosa", "I can move Noor's shift for sixty nights. That is scheduling work the city pushed onto this counter.", 4.9),
    spoken("kai", "Log the hours. Community labour does not become free because it is voluntary.", 4.2),
  ]),
  anonymous_epilogue: sequence("anonymous_epilogue", true, [
    spoken("desmond", "The first trial bus leaves Monday. My name is nowhere in the packet.", 4.0),
    spoken("malik", "And in sixty nights we may be back here.", 3.2),
    spoken("kai", "Then the record will show who rode, what was cut, and who carried the counting. Not an empty machine.", 5.0),
    spoken("rosa", "Good. Close the file. I still have a diner to run.", 3.4),
  ]),
  signed_collect: sequence("signed_collect", false, [
    spoken("nadiya", "Five signatures. Five disclosures. I consented; I did not become grateful for the rule.", 4.8),
    spoken("kai", "Your objection is attached, not summarized away.", 3.0),
  ]),
  signed_file: sequence("signed_file", false, [
    spoken("evelyn", "Twelve months, full timetable. The five travel windows are now public contract evidence.", 4.8),
    spoken("kai", "A funded route and a permanent record. Stamp both facts.", 3.4),
  ]),
  signed_diner: sequence("signed_diner", false, [
    spoken("rosa", "A year means I keep Noor on nights. It also means Nadiya's work pattern is searchable for that year.", 4.9),
    spoken("kai", "Security for the route did not become security for the riders.", 3.6),
  ]),
  signed_epilogue: sequence("signed_epilogue", true, [
    spoken("malik", "Full run starts Monday. No shifts cut.", 3.0),
    spoken("nadiya", "My bus is safer than my record.", 3.0),
    spoken("evelyn", "Next tender, I can propose aggregate evidence. I cannot unpublish this one.", 4.3),
    spoken("kai", "Then changing that rule is next. Tonight, we do not call this clean.", 4.2),
    spoken("rosa", "Good. Put the contract away and tell Noor her shift is safe.", 3.8),
  ]),
});

export const NIGHT_ROUTE_SURVEY_STOPS = deepFreeze([
  {
    id: "pulse_station_validator",
    label: "COUNT THE PULSE STATION CASH RIDERS",
    anchorKey: "pulseStation",
    position: NIGHT_ROUTE_ANCHORS.pulseStation,
    characterId: NIGHT_ROUTE_CHARACTERS.malik.id,
    sequenceId: "pulse_station_count",
  },
  {
    id: "civic_plaza_shift",
    label: "RECORD THE CIVIC PLAZA BOARDINGS",
    anchorKey: "civicPlaza",
    position: NIGHT_ROUTE_ANCHORS.civicPlaza,
    characterId: NIGHT_ROUTE_CHARACTERS.desmond.id,
    sequenceId: "civic_count",
  },
  {
    id: "westside_clinic_shift",
    label: "RECORD THE WESTSIDE CLINIC BOARDINGS",
    anchorKey: "westsideClinic",
    position: NIGHT_ROUTE_ANCHORS.westsideClinic,
    characterId: NIGHT_ROUTE_CHARACTERS.nadiya.id,
    sequenceId: "clinic_count",
  },
  {
    id: "southline_diner_count",
    label: "VERIFY THE FOUR-RUN COUNT WITH ROSA",
    anchorKey: "southlineDiner",
    position: NIGHT_ROUTE_ANCHORS.southlineDiner,
    characterId: NIGHT_ROUTE_CHARACTERS.rosa.id,
    sequenceId: "diner_count",
  },
]);

function task(id, label, anchorKey, sequenceId) {
  return deepFreeze({ id, label, anchorKey, position: NIGHT_ROUTE_ANCHORS[anchorKey], sequenceId });
}

export const NIGHT_ROUTE_AFTERMATH = deepFreeze({
  anonymous_trial: {
    introSequenceId: "choose_anonymous_trial",
    epilogueSequenceId: "anonymous_epilogue",
    tasks: [
      task("file_anonymous_count", "SUBMIT THE ANONYMOUS COUNTER SHEETS", "communityNoticeboard", "anonymous_file"),
      task("post_trial_timetable", "POST THE SIXTY-NIGHT TRIAL TIMETABLE", "pulseStation", "anonymous_timetable"),
      task("brief_rosa_trial", "BRING THE WEEKEND CUTS TO ROSA", "southlineDiner", "anonymous_diner"),
    ],
  },
  signed_year: {
    introSequenceId: "choose_signed_year",
    epilogueSequenceId: "signed_epilogue",
    tasks: [
      task("collect_affidavits", "COLLECT THE FIVE INFORMED AFFIDAVITS", "westsideClinic", "signed_collect"),
      task("file_public_register", "FILE THE PUBLIC RIDER REGISTER", "communityNoticeboard", "signed_file"),
      task("brief_rosa_contract", "BRING THE YEAR CONTRACT TO ROSA", "southlineDiner", "signed_diner"),
    ],
  },
});

export const NIGHT_ROUTE_CHOICE = deepFreeze({
  id: "night_route_evidence",
  prompt: "WHAT EVIDENCE DOES KAI FILE?",
  context: "Anonymous counts protect every rider's private schedule but secure only sixty trial nights and cut two late runs. Five informed affidavits secure the full route for a year, while names, employer bands, and travel windows become public contract evidence.",
  options: [
    {
      id: "anonymous_trial",
      label: "FILE ANONYMOUS COUNTS",
      summary: "SIXTY-NIGHT TRIAL; TWO LATE RUNS CUT; NO RIDER RECORDS PUBLISHED",
      unresolvedCost: "The riders keep control of their work patterns, but the route remains temporary, two driver shifts disappear, and neighbours inherit weekly counting work.",
      ledger: {
        serviceDaysSecured: 60,
        fullTimetableMonths: 0,
        publicRiderRecords: 0,
        lateRunsCut: 2,
        weeklyCountingHours: 8,
      },
    },
    {
      id: "signed_year",
      label: "FILE FIVE INFORMED AFFIDAVITS",
      summary: "FULL ROUTE FOR ONE YEAR; FIVE PRIVATE WORK PATTERNS ENTER THE PUBLIC RECORD",
      unresolvedCost: "The full route and every driver shift survive for a year, but five riders had to make their working lives public to receive ordinary transport.",
      ledger: {
        serviceDaysSecured: 365,
        fullTimetableMonths: 12,
        publicRiderRecords: 5,
        lateRunsCut: 0,
        weeklyCountingHours: 0,
      },
    },
  ],
});

const EMPTY_LEDGER = deepFreeze(Object.fromEntries(LEDGER_KEYS.map(key => [key, 0])));
const OPTION_BY_ID = new Map(NIGHT_ROUTE_CHOICE.options.map(option => [option.id, option]));
const SEQUENCE_BY_ID = new Map(Object.values(NIGHT_ROUTE_SEQUENCES).map(value => [value.id, value]));
const SURVEY_SEQUENCE_IDS = new Set(NIGHT_ROUTE_SURVEY_STOPS.map(value => value.sequenceId));
const PHASE_VALUES = new Set(Object.values(NIGHT_ROUTE_PHASES));

function configuredAnchors(overrides = null) {
  return deepFreeze(Object.fromEntries(Object.entries(NIGHT_ROUTE_ANCHORS).map(([key, value]) => [
    key,
    point(overrides?.[key] ?? value, value),
  ])));
}

function configuredStops(definitions, anchors) {
  return deepFreeze(definitions.map(definition => ({
    ...definition,
    position: anchors[definition.anchorKey],
  })));
}

function countFrom(value, fallback = 0) {
  if (value === true) return 1;
  return Math.max(0, integer(value, fallback));
}

function progression(context = {}) {
  const lifeActivitiesCompleted = countFrom(
    context.lifeActivitiesCompleted ?? context.life?.completedCount ?? context.lifeActivity?.completedCount,
  );
  const taxiFaresCompleted = countFrom(
    context.taxiFaresCompleted ?? context.taxi?.completedCount ?? context.activities?.taxi?.completedCount,
  );
  const southlineFamiliarity = countFrom(
    context.southlineFamiliarity ?? context.businessFamiliarity?.southline_diner ??
      context.neighbourhoodSave?.familiarity?.[SOUTHLINE_BUSINESS_INDEX] ??
      context.neighbourhood?.familiarityByBusiness?.southline_diner ??
      context.neighbourhood?.southlineFamiliarity ??
      (context.neighbourhood?.businessId === "southline_diner" ? context.neighbourhood?.familiarity : 0),
  );
  return { lifeActivitiesCompleted, taxiFaresCompleted, southlineFamiliarity };
}

function availabilityFor(context = {}) {
  const progress = progression(context);
  const missing = [];
  if (progress.lifeActivitiesCompleted < NIGHT_ROUTE_REQUIREMENTS.lifeActivitiesCompleted) missing.push("complete_two_city_activities");
  if (progress.taxiFaresCompleted < NIGHT_ROUTE_REQUIREMENTS.taxiFaresCompleted) missing.push("complete_one_night_fare");
  if (progress.southlineFamiliarity < NIGHT_ROUTE_REQUIREMENTS.southlineFamiliarity) missing.push("become_a_southline_regular");
  return deepFreeze({
    unlocked: missing.length === 0,
    missing,
    progress,
    requirements: NIGHT_ROUTE_REQUIREMENTS,
    hubLabel: NIGHT_ROUTE_STORY.hubLabel,
    hubPosition: NIGHT_ROUTE_STORY.hubPosition,
  });
}

function rejected(reason, phase, detail = null) {
  return Object.freeze({ accepted: false, reason, phase, detail });
}

function accepted(phase, detail = null) {
  return Object.freeze({ accepted: true, reason: null, phase, detail });
}

function sameLedger(first, second) {
  return LEDGER_KEYS.every(key => integer(first?.[key], -1) === integer(second?.[key], -2)) &&
    Object.keys(first ?? {}).length === LEDGER_KEYS.length;
}

function assertPlainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
}

/**
 * Deterministic, renderer-independent ordinary-life story. The host supplies
 * position and vehicle facts and owns presentation, rewards, and persistence.
 */
export function createNightRouteStory(options = {}) {
  const anchors = configuredAnchors(options.anchors);
  const surveyStops = configuredStops(NIGHT_ROUTE_SURVEY_STOPS, anchors);
  const aftermathByChoice = deepFreeze(Object.fromEntries(Object.entries(NIGHT_ROUTE_AFTERMATH).map(([choiceId, branch]) => [
    choiceId,
    {
      ...branch,
      tasks: configuredStops(branch.tasks, anchors),
    },
  ])));
  const interactionRadius = Math.max(0.5, finite(options.interactionRadius, 4.5));
  const interactionRadiusSquared = interactionRadius * interactionRadius;
  const maximumSurveySpeed = Math.max(0, finite(options.maximumSurveySpeed, 0.8));

  let phase;
  let started;
  let completed;
  let activeSequenceId;
  let lineIndex;
  let lineElapsed;
  let elapsed;
  let sequenceSerial;
  let dialogueSerial;
  let eventSerial;
  let surveyIndex;
  let choiceActive;
  let choiceResult;
  let aftermathIndex;
  let moralLedger;
  let completionEmitted;
  let lastEvent;
  let emitted;
  let mutationSerial;
  let cachedSnapshot;
  let cachedSnapshotSerial;
  let prewarmResult = null;

  function initialize() {
    phase = NIGHT_ROUTE_PHASES.LOCKED;
    started = false;
    completed = false;
    activeSequenceId = null;
    lineIndex = 0;
    lineElapsed = 0;
    elapsed = 0;
    sequenceSerial = 0;
    dialogueSerial = 0;
    eventSerial = 0;
    surveyIndex = 0;
    choiceActive = false;
    choiceResult = null;
    aftermathIndex = 0;
    moralLedger = { ...EMPTY_LEDGER };
    completionEmitted = false;
    lastEvent = "locked";
    emitted = [];
    mutationSerial = 0;
    cachedSnapshot = null;
    cachedSnapshotSerial = -1;
  }

  initialize();

  function touch() {
    mutationSerial += 1;
    cachedSnapshot = null;
  }

  function emit(type, detail = {}) {
    eventSerial += 1;
    const event = deepFreeze({ serial: eventSerial, type: String(type), ...detail });
    emitted.push(event);
    lastEvent = event.type;
    touch();
    return event;
  }

  function activeSequence() {
    return activeSequenceId ? SEQUENCE_BY_ID.get(activeSequenceId) ?? null : null;
  }

  function activeLine() {
    return activeSequence()?.lines[lineIndex] ?? null;
  }

  function beginLine() {
    const line = activeLine();
    if (!line) return;
    dialogueSerial += 1;
    lineElapsed = 0;
    emit("dialogue_started", {
      dialogueSerial,
      sequenceId: activeSequenceId,
      lineIndex,
      speaker: line.speaker,
    });
  }

  function startSequence(sequenceId) {
    const sequenceValue = SEQUENCE_BY_ID.get(String(sequenceId));
    if (!sequenceValue) throw new RangeError(`Unknown Night Route sequence: ${sequenceId}`);
    activeSequenceId = sequenceValue.id;
    lineIndex = 0;
    lineElapsed = 0;
    sequenceSerial += 1;
    emit("sequence_started", { sequenceId: sequenceValue.id, sequenceSerial });
    beginLine();
  }

  function currentBranch() {
    return choiceResult ? aftermathByChoice[choiceResult] ?? null : null;
  }

  function completeStory() {
    if (completed) return;
    phase = NIGHT_ROUTE_PHASES.COMPLETE;
    completed = true;
    choiceActive = false;
    activeSequenceId = null;
    lineIndex = 0;
    lineElapsed = 0;
    if (!completionEmitted) {
      completionEmitted = true;
      const option = OPTION_BY_ID.get(choiceResult);
      emit("ordinary_story_completed", {
        storyId: NIGHT_ROUTE_STORY.id,
        choiceId: choiceResult,
        moralLedger: deepFreeze({ ...moralLedger }),
        unresolvedCost: option.unresolvedCost,
      });
    } else touch();
  }

  function afterSequence(sequenceId) {
    if (sequenceId === "briefing") {
      phase = NIGHT_ROUTE_PHASES.SURVEY;
      emit("survey_started", { stopCount: surveyStops.length });
      return;
    }
    if (SURVEY_SEQUENCE_IDS.has(sequenceId)) {
      if (surveyIndex >= surveyStops.length) {
        phase = NIGHT_ROUTE_PHASES.DECISION;
        startSequence("evidence_decision");
      }
      return;
    }
    if (sequenceId === "evidence_decision") {
      choiceActive = true;
      emit("choice_requested", { choiceId: NIGHT_ROUTE_CHOICE.id });
      return;
    }
    const branch = currentBranch();
    if (!branch) return;
    if (sequenceId === branch.introSequenceId) {
      phase = NIGHT_ROUTE_PHASES.AFTERMATH;
      aftermathIndex = 0;
      emit("aftermath_started", { choiceId: choiceResult, taskCount: branch.tasks.length });
      return;
    }
    if (branch.tasks.some(taskValue => taskValue.sequenceId === sequenceId)) {
      if (aftermathIndex >= branch.tasks.length) startSequence(branch.epilogueSequenceId);
      return;
    }
    if (sequenceId === branch.epilogueSequenceId) completeStory();
  }

  function finishSequence() {
    const finishedId = activeSequenceId;
    activeSequenceId = null;
    lineIndex = 0;
    lineElapsed = 0;
    emit("sequence_completed", { sequenceId: finishedId });
    afterSequence(finishedId);
  }

  function advanceLine() {
    const sequenceValue = activeSequence();
    if (!sequenceValue) return false;
    lineIndex += 1;
    if (lineIndex >= sequenceValue.lines.length) finishSequence();
    else beginLine();
    return true;
  }

  function availability(context = {}) {
    const value = availabilityFor(context);
    if (anchors.southlineDiner === NIGHT_ROUTE_STORY.hubPosition) return value;
    return deepFreeze({ ...value, hubPosition: anchors.southlineDiner });
  }

  function begin(context = {}) {
    if (started) return rejected("already_started", phase);
    const access = availability(context);
    if (!access.unlocked) return rejected("ordinary_progress_required", phase, access.missing);
    started = true;
    phase = NIGHT_ROUTE_PHASES.BRIEFING;
    emit("ordinary_story_started", { storyId: NIGHT_ROUTE_STORY.id });
    startSequence("briefing");
    return accepted(phase, NIGHT_ROUTE_STORY.id);
  }

  function update(delta = 0, optionsValue = {}) {
    const dt = clamp(delta, 0, 0.25);
    const captureSnapshot = optionsValue.captureSnapshot !== false;
    if (dt > 0) {
      elapsed += dt;
      if (activeLine()) lineElapsed += dt;
      touch();
    }
    const line = activeLine();
    if (line && (optionsValue.skip === true || lineElapsed >= line.duration)) advanceLine();
    return captureSnapshot ? snapshot() : null;
  }

  function normalizedVehicleAccess(event) {
    return String(event?.vehicleAccess ?? event?.vehicle?.activityAccess ?? event?.vehicle?.access ?? "");
  }

  function interact(event = {}) {
    if (!started) return rejected("story_not_started", phase);
    if (completed) return rejected("story_complete", phase);
    if (activeSequenceId) return rejected("dialogue_active", phase);
    const position = point(event.position ?? event.playerPosition ?? [0, 0, 0]);

    if (phase === NIGHT_ROUTE_PHASES.SURVEY) {
      const stopValue = surveyStops[surveyIndex] ?? null;
      if (!stopValue) return rejected("survey_complete", phase);
      if (event.inVehicle !== true || normalizedVehicleAccess(event) !== "pulse-line") {
        return rejected("pulse_line_vehicle_required", phase, stopValue.id);
      }
      if (Math.abs(finite(event.speed ?? event.vehicleSpeed)) > maximumSurveySpeed) {
        return rejected("vehicle_must_stop", phase, stopValue.id);
      }
      if (squaredDistance(position, stopValue.position) > interactionRadiusSquared) {
        return rejected("too_far", phase, stopValue.id);
      }
      surveyIndex += 1;
      emit("survey_stop_completed", {
        stopId: stopValue.id,
        stopIndex: surveyIndex - 1,
        characterId: stopValue.characterId,
      });
      startSequence(stopValue.sequenceId);
      return accepted(phase, stopValue.id);
    }

    if (phase === NIGHT_ROUTE_PHASES.AFTERMATH) {
      const branch = currentBranch();
      const taskValue = branch?.tasks[aftermathIndex] ?? null;
      if (!taskValue) return rejected("aftermath_complete", phase);
      if (event.inVehicle === true) return rejected("continue_on_foot", phase, taskValue.id);
      if (squaredDistance(position, taskValue.position) > interactionRadiusSquared) {
        return rejected("too_far", phase, taskValue.id);
      }
      aftermathIndex += 1;
      emit("aftermath_task_completed", {
        choiceId: choiceResult,
        taskId: taskValue.id,
        taskIndex: aftermathIndex - 1,
      });
      startSequence(taskValue.sequenceId);
      return accepted(phase, taskValue.id);
    }

    return rejected(phase === NIGHT_ROUTE_PHASES.DECISION ? "choice_required" : "no_active_target", phase);
  }

  function choose(optionId) {
    if (phase !== NIGHT_ROUTE_PHASES.DECISION || !choiceActive || activeSequenceId) {
      return rejected("choice_not_available", phase);
    }
    const option = OPTION_BY_ID.get(String(optionId));
    if (!option) throw new RangeError(`Unknown Night Route choice: ${optionId}`);
    choiceResult = option.id;
    moralLedger = { ...option.ledger };
    choiceActive = false;
    emit("choice_made", {
      choiceId: NIGHT_ROUTE_CHOICE.id,
      optionId: option.id,
      moralLedger: deepFreeze({ ...moralLedger }),
      unresolvedCost: option.unresolvedCost,
    });
    startSequence(aftermathByChoice[option.id].introSequenceId);
    return accepted(phase, option.id);
  }

  function objective() {
    if (activeSequenceId) return activeSequence()?.blocking ? "LISTEN" : "CONTINUE THE NIGHT COUNT";
    if (phase === NIGHT_ROUTE_PHASES.SURVEY) return surveyStops[surveyIndex]?.label ?? "RETURN TO SOUTHLINE DINER";
    if (phase === NIGHT_ROUTE_PHASES.DECISION) return choiceActive ? NIGHT_ROUTE_CHOICE.prompt : "HEAR THE AUDIT TERMS";
    if (phase === NIGHT_ROUTE_PHASES.AFTERMATH) return currentBranch()?.tasks[aftermathIndex]?.label ?? "FACE THE CONSEQUENCE";
    if (phase === NIGHT_ROUTE_PHASES.COMPLETE) return "THE NIGHT COUNT IS FILED";
    return "BUILD A LIFE IN THE CITY";
  }

  function targetPosition() {
    if (activeSequenceId) return null;
    if (phase === NIGHT_ROUTE_PHASES.SURVEY) return surveyStops[surveyIndex]?.position ?? null;
    if (phase === NIGHT_ROUTE_PHASES.AFTERMATH) return currentBranch()?.tasks[aftermathIndex]?.position ?? null;
    return phase === NIGHT_ROUTE_PHASES.LOCKED ? anchors.southlineDiner : null;
  }

  function consequenceView() {
    const option = choiceResult ? OPTION_BY_ID.get(choiceResult) : null;
    if (!option) return null;
    return deepFreeze({
      choiceId: option.id,
      label: option.label,
      unresolvedCost: option.unresolvedCost,
      moralLedger: { ...moralLedger },
      durable: true,
      completed,
    });
  }

  function snapshot() {
    if (cachedSnapshot && cachedSnapshotSerial === mutationSerial) return cachedSnapshot;
    const sequenceValue = activeSequence();
    const line = activeLine();
    const dialogueActive = Boolean(line);
    const dialogue = deepFreeze({
      active: dialogueActive,
      serial: dialogueSerial,
      speaker: line?.speaker ?? null,
      role: line?.role ?? null,
      text: line?.text ?? "",
      remaining: line ? Math.max(0, line.duration - lineElapsed) : 0,
    });
    cachedSnapshot = deepFreeze({
      version: NIGHT_ROUTE_SAVE_VERSION,
      kind: NIGHT_ROUTE_STORY.kind,
      id: NIGHT_ROUTE_STORY.id,
      title: NIGHT_ROUTE_STORY.title,
      subtitle: NIGHT_ROUTE_STORY.subtitle,
      phase,
      status: phase === NIGHT_ROUTE_PHASES.LOCKED ? "locked" : completed ? "completed" : "active",
      started,
      completed,
      objective: objective(),
      targetKind: phase === NIGHT_ROUTE_PHASES.SURVEY ? "route_stop" :
        phase === NIGHT_ROUTE_PHASES.AFTERMATH ? "interaction" : null,
      targetPosition: targetPosition(),
      hubLabel: NIGHT_ROUTE_STORY.hubLabel,
      hubPosition: anchors.southlineDiner,
      requiredVehicleAccess: phase === NIGHT_ROUTE_PHASES.SURVEY ? "pulse-line" : null,
      onFoot: phase === NIGHT_ROUTE_PHASES.AFTERMATH,
      surveyIndex,
      surveyCount: surveyStops.length,
      surveyedStopIds: surveyStops.slice(0, surveyIndex).map(value => value.id),
      aftermathIndex,
      aftermathCount: currentBranch()?.tasks.length ?? 0,
      activeSequenceId,
      sequenceSerial,
      lineIndex,
      lineElapsed,
      controlsLocked: Boolean(sequenceValue?.blocking || choiceActive),
      choice: choiceActive ? NIGHT_ROUTE_CHOICE : null,
      choiceResult,
      moralLedger: { ...moralLedger },
      consequence: consequenceView(),
      elapsed,
      dialogueSerial,
      dialogue,
      eventSerial,
      pendingEventCount: emitted.length,
      completionEmitted,
      lastEvent,
    });
    cachedSnapshotSerial = mutationSerial;
    return cachedSnapshot;
  }

  function save() {
    return deepFreeze({
      version: NIGHT_ROUTE_SAVE_VERSION,
      phase,
      started,
      completed,
      activeSequenceId,
      lineIndex,
      lineElapsed,
      elapsed,
      sequenceSerial,
      dialogueSerial,
      eventSerial,
      surveyIndex,
      choiceActive,
      choiceResult,
      aftermathIndex,
      moralLedger: { ...moralLedger },
      completionEmitted,
      lastEvent,
      pendingEvents: jsonClone(emitted),
    });
  }

  function restore(value = {}) {
    assertPlainRecord(value, "Night Route save");
    if (integer(value.version, -1) !== NIGHT_ROUTE_SAVE_VERSION) throw new RangeError("Unsupported Night Route save version.");
    if (!PHASE_VALUES.has(value.phase)) throw new RangeError(`Unknown Night Route phase: ${value.phase}`);
    if (typeof value.started !== "boolean" || typeof value.completed !== "boolean") {
      throw new TypeError("Night Route save requires boolean started/completed flags.");
    }
    const restoredSequence = value.activeSequenceId === null ? null : SEQUENCE_BY_ID.get(String(value.activeSequenceId));
    if (value.activeSequenceId !== null && !restoredSequence) throw new RangeError(`Unknown Night Route sequence: ${value.activeSequenceId}`);
    const restoredLineIndex = Math.max(0, integer(value.lineIndex));
    if (restoredSequence && restoredLineIndex >= restoredSequence.lines.length) throw new RangeError("Night Route line index is outside its sequence.");
    if (!restoredSequence && restoredLineIndex !== 0) throw new RangeError("Night Route save cannot retain a line without a sequence.");
    const restoredChoice = value.choiceResult === null ? null : OPTION_BY_ID.get(String(value.choiceResult));
    if (value.choiceResult !== null && !restoredChoice) throw new RangeError(`Unknown Night Route choice: ${value.choiceResult}`);
    assertPlainRecord(value.moralLedger, "Night Route moralLedger");
    const expectedLedger = restoredChoice?.ledger ?? EMPTY_LEDGER;
    if (!sameLedger(value.moralLedger, expectedLedger)) throw new RangeError("Night Route moral ledger does not match its durable choice.");
    const restoredSurveyIndex = Math.max(0, integer(value.surveyIndex));
    if (restoredSurveyIndex > surveyStops.length) throw new RangeError("Night Route survey index is outside the route.");
    const restoredAftermathIndex = Math.max(0, integer(value.aftermathIndex));
    const restoredBranch = restoredChoice ? aftermathByChoice[restoredChoice.id] : null;
    if (restoredAftermathIndex > (restoredBranch?.tasks.length ?? 0)) throw new RangeError("Night Route aftermath index is outside its branch.");
    if (value.phase === NIGHT_ROUTE_PHASES.AFTERMATH && !restoredChoice) throw new RangeError("Night Route aftermath requires a choice.");
    if (value.completed && (value.phase !== NIGHT_ROUTE_PHASES.COMPLETE || !restoredChoice || restoredAftermathIndex !== restoredBranch.tasks.length)) {
      throw new RangeError("Completed Night Route save requires a completed consequence branch.");
    }
    if (Boolean(value.completionEmitted) !== Boolean(value.completed)) {
      throw new RangeError("Night Route completion emission must match completion state.");
    }
    if (Boolean(value.choiceActive) && (value.phase !== NIGHT_ROUTE_PHASES.DECISION || restoredSequence || restoredChoice)) {
      throw new RangeError("Night Route choice can only be active after the decision dialogue.");
    }
    if (!Array.isArray(value.pendingEvents)) throw new TypeError("Night Route pendingEvents must be an array.");
    const restoredEventSerial = Math.max(0, integer(value.eventSerial));
    let previousEventSerial = 0;
    for (const event of value.pendingEvents) {
      assertPlainRecord(event, "Night Route pending event");
      const serial = integer(event.serial, -1);
      if (serial <= previousEventSerial || serial > restoredEventSerial || typeof event.type !== "string") {
        throw new RangeError("Night Route pending events must have ordered, valid serials.");
      }
      previousEventSerial = serial;
    }

    phase = value.phase;
    started = value.started;
    completed = value.completed;
    activeSequenceId = restoredSequence?.id ?? null;
    lineIndex = restoredLineIndex;
    lineElapsed = Math.max(0, finite(value.lineElapsed));
    elapsed = Math.max(0, finite(value.elapsed));
    sequenceSerial = Math.max(0, integer(value.sequenceSerial));
    dialogueSerial = Math.max(0, integer(value.dialogueSerial));
    eventSerial = restoredEventSerial;
    surveyIndex = restoredSurveyIndex;
    choiceActive = Boolean(value.choiceActive);
    choiceResult = restoredChoice?.id ?? null;
    aftermathIndex = restoredAftermathIndex;
    moralLedger = { ...expectedLedger };
    completionEmitted = Boolean(value.completionEmitted);
    lastEvent = String(value.lastEvent ?? "restored");
    emitted = value.pendingEvents.map(event => deepFreeze(jsonClone(event)));
    touch();
    return snapshot();
  }

  function drainEvents() {
    if (!emitted.length) return EMPTY_EVENTS;
    const result = Object.freeze(emitted.splice(0, emitted.length));
    touch();
    return result;
  }

  function reset() {
    initialize();
    return snapshot();
  }

  function prewarm() {
    if (prewarmResult) return prewarmResult;
    const liveBits = JSON.stringify(save());
    let completionsPrepared = 0;
    let surveyStopsPrepared = 0;
    let aftermathTasksPrepared = 0;
    const progress = {
      lifeActivitiesCompleted: NIGHT_ROUTE_REQUIREMENTS.lifeActivitiesCompleted,
      taxiFaresCompleted: NIGHT_ROUTE_REQUIREMENTS.taxiFaresCompleted,
      southlineFamiliarity: NIGHT_ROUTE_REQUIREMENTS.southlineFamiliarity,
    };
    for (const option of NIGHT_ROUTE_CHOICE.options) {
      const simulation = createNightRouteStory({
        anchors,
        interactionRadius,
        maximumSurveySpeed,
      });
      const skipDialogue = () => {
        let guard = 0;
        while (simulation.snapshot().dialogue.active && guard++ < 128) simulation.update(0, { skip: true, captureSnapshot: false });
        if (guard >= 128) throw new Error("Night Route prewarm dialogue did not settle.");
      };
      if (!simulation.begin(progress).accepted) throw new Error("Night Route prewarm could not start.");
      skipDialogue();
      for (const stopValue of surveyStops) {
        const result = simulation.interact({
          position: stopValue.position,
          inVehicle: true,
          vehicleAccess: "pulse-line",
          speed: 0,
        });
        if (!result.accepted) throw new Error(`Night Route prewarm missed survey stop: ${stopValue.id}`);
        surveyStopsPrepared += 1;
        skipDialogue();
      }
      if (!simulation.choose(option.id).accepted) throw new Error(`Night Route prewarm choice failed: ${option.id}`);
      skipDialogue();
      for (const taskValue of aftermathByChoice[option.id].tasks) {
        const result = simulation.interact({ position: taskValue.position, inVehicle: false });
        if (!result.accepted) throw new Error(`Night Route prewarm missed aftermath task: ${taskValue.id}`);
        aftermathTasksPrepared += 1;
        skipDialogue();
      }
      if (!simulation.snapshot().completed) throw new Error(`Night Route prewarm branch did not complete: ${option.id}`);
      completionsPrepared += 1;
    }
    if (JSON.stringify(save()) !== liveBits) throw new Error("Night Route prewarm mutated live story state.");
    prewarmResult = deepFreeze({
      ready: true,
      storage: "memory-only",
      sequencesPrepared: SEQUENCE_BY_ID.size,
      linesPrepared: Object.values(NIGHT_ROUTE_SEQUENCES).reduce((total, value) => total + value.lines.length, 0),
      branchesPrepared: NIGHT_ROUTE_CHOICE.options.length,
      surveyStopsPrepared,
      aftermathTasksPrepared,
      completionsPrepared,
      runtimeAssetsCreated: 0,
      liveStateUnchanged: true,
    });
    return prewarmResult;
  }

  return Object.freeze({
    availability,
    begin,
    update,
    advance: update,
    interact,
    choose,
    snapshot,
    save,
    restore,
    drainEvents,
    reset,
    prewarm,
    anchors,
    surveyStops,
    aftermath: aftermathByChoice,
  });
}

export const createNightRouteCampaign = createNightRouteStory;
