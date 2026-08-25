export const STORY_SAVE_VERSION = 2;

export const STORY_PHASES = Object.freeze({
  ARRIVAL: "arrival",
  MEET_JUNO: "meet_juno",
  BRIEFING: "briefing",
  RECOVER_COMET: "recover_comet",
  ESCAPE_VOSS: "escape_voss",
  RETURN_TO_GARAGE: "return_to_garage",
  RESOLUTION: "resolution",
  FREE_ROAM: "free_roam",
});

const CHAPTER = Object.freeze({
  number: 1,
  id: "home_again",
  title: "HOME AGAIN",
  subtitle: "FAMILY, WORK, AND ONE CAR THAT CAN CHANGE THE CITY",
});

const EVIDENCE_CHOICE = Object.freeze({
  id: "audit_drive_release",
  prompt: "THE DRIVE PROVES CORRUPTION, BUT IT ALSO NAMES PEOPLE VOSS COERCED.",
  options: Object.freeze([
    Object.freeze({
      id: "publish",
      label: "PUBLISH NOW",
      summary: "STOP VOSS TODAY; EXPOSE COERCED SOURCES",
      sequenceId: "public_release",
      pressure: 3,
      sourceSafety: -2,
    }),
    Object.freeze({
      id: "protect",
      label: "PROTECT SOURCES",
      summary: "SHIELD THEM; GIVE VOSS TIME TO FIGHT",
      sequenceId: "protected_case",
      pressure: -1,
      sourceSafety: 3,
    }),
  ]),
});

function line(speaker, text, duration, shot, extras = {}) {
  return Object.freeze({
    speaker: String(speaker),
    text: String(text),
    duration: Math.max(0.8, Number(duration) || 3),
    shot: String(shot || "player_wide"),
    tone: String(extras.tone ?? "conversation"),
  });
}

export const STORY_SEQUENCES = Object.freeze({
  homecoming: Object.freeze({
    id: "homecoming",
    cinematic: true,
    titleCard: "CHAPTER ONE  /  HOME AGAIN",
    lines: Object.freeze([
      line("NEON CITY", "07:12. PULSE STREET IS ALREADY AWAKE.", 3.1, "city_dawn", { tone: "title" }),
      line("JUNO", "Kai? You made it. I need a hand at the garage, but come as you are. No trouble.", 4.7, "kai_phone"),
      line("KAI", "I came home to keep things steady, not start a war.", 3.7, "kai_close"),
      line("JUNO", "Good. Walk over. You have not seen Pulse Street in daylight for years.", 4.3, "walk_to_garage"),
    ]),
  }),
  garage_briefing: Object.freeze({
    id: "garage_briefing",
    cinematic: true,
    titleCard: "PULSE GARAGE  /  FAMILY BUSINESS",
    lines: Object.freeze([
      line("JUNO", "Marisol missed one payment while her son was in hospital. Her registration is clean. Voss took the Comet anyway.", 5.8, "juno_wide"),
      line("RIN", "The seizure order is forged, but it carries a real city contract number. Someone made theft look administrative.", 5.8, "rin_close"),
      line("RIN", "The audit drive is still in the dash. It names officials who profited—and mechanics who signed because Voss threatened their families.", 6.4, "garage_two_shot"),
      line("KAI", "Then the truth can clear Marisol and still ruin people he cornered.", 4.5, "kai_garage_close"),
      line("JUNO", "This is returning a customer's car. Bring it home intact. If police believe that paper, do not hurt anyone for Voss's lie.", 6.2, "juno_close"),
      line("KAI", "I will get the car. We decide what the drive costs when we are all in the room.", 4.7, "comet_reveal"),
    ]),
  }),
  corrupt_flag: Object.freeze({
    id: "corrupt_flag",
    cinematic: false,
    lines: Object.freeze([
      line("RIN / PHONE", "They flagged the real owner as the thief. That is Voss's trick: make honest people look guilty.", 5.2, "radio"),
      line("KAI", "Copy. No heroics. I bring the Comet and the evidence home.", 4.1, "radio"),
    ]),
  }),
  route_clear: Object.freeze({
    id: "route_clear",
    cinematic: false,
    lines: Object.freeze([
      line("JUNO / PHONE", "You are clear. Easy now. Marisol wants her car back, not a sculpture.", 4.6, "radio"),
    ]),
  }),
  garage_return: Object.freeze({
    id: "garage_return",
    cinematic: true,
    titleCard: "PULSE GARAGE  /  09:03",
    lines: Object.freeze([
      line("JUNO", "The VIN is intact. Marisol gets her car back. That part is simple.", 4.2, "garage_return"),
      line("RIN", "The rest is not. Publish tonight and Voss loses the harbour vote before he can bury this.", 4.9, "rin_close"),
      line("JUNO", "Page forty-two has Nia's address. Voss forced her signature. A raw leak turns his victim into his witness list.", 6.0, "juno_close"),
      line("RIN", "Redaction takes weeks. His contract renews Friday. Delay has victims too—we just will not know their names yet.", 5.9, "rin_close"),
      line("KAI", "So speed risks the people already hurt, and caution risks the people he hurts next.", 5.2, "kai_garage_close"),
      line("JUNO", "Yes. You brought the choice home. That does not make it clean.", 4.4, "siblings_wide"),
    ]),
  }),
  public_release: Object.freeze({
    id: "public_release",
    cinematic: true,
    titleCard: "THE PUBLIC RECORD  /  23:41",
    lines: Object.freeze([
      line("RIN", "It is live. Three councillors recused themselves in eleven minutes. Voss cannot quietly renew the contract now.", 5.8, "rin_close"),
      line("JUNO", "Nia closed her shop and left through the back. We stopped his vote. We also told him exactly who could testify.", 5.9, "juno_close"),
      line("KAI", "I chose speed because delay was doing harm. If my certainty makes someone else pay, I do not get to call that victory.", 6.3, "kai_garage_close"),
    ]),
  }),
  protected_case: Object.freeze({
    id: "protected_case",
    cinematic: true,
    titleCard: "UNDER SEAL  /  23:41",
    lines: Object.freeze([
      line("JUNO", "Union counsel has the original. The source list is sealed, and Nia has somewhere safe tonight.", 5.4, "juno_close"),
      line("RIN", "Voss filed an injunction before noon. He keeps the harbour contract while lawyers argue about evidence he knows exists.", 6.0, "rin_close"),
      line("KAI", "I chose their safety because they never chose this fight. That does not make the people he hurts while we wait imaginary.", 6.4, "kai_garage_close"),
    ]),
  }),
});

function validPhase(value) {
  const phase = String(value ?? "");
  return Object.values(STORY_PHASES).includes(phase) ? phase : STORY_PHASES.ARRIVAL;
}

function sequenceById(value) {
  const id = String(value ?? "");
  return Object.values(STORY_SEQUENCES).find(sequence => sequence.id === id) ?? null;
}

/**
 * Renderer-independent authored campaign state. Gameplay sends meaningful
 * events; the story emits explicit commands such as start_recovery rather than
 * reaching into mission, camera, or HUD objects itself.
 */
export function createStoryCampaign({ autoBegin = true } = {}) {
  let phase = STORY_PHASES.ARRIVAL;
  let activeSequence = null;
  let lineIndex = 0;
  let lineElapsed = 0;
  let storyElapsed = 0;
  let chapterStarted = false;
  let chapterCompleted = false;
  let briefingCompleted = false;
  let openingCompleted = false;
  let sequenceSerial = 0;
  let lastEvent = null;
  let activeChoice = null;
  let choiceResult = null;
  let publicPressure = 0;
  let sourceSafety = 0;
  const completedSequences = new Set();
  const emitted = [];

  function emit(type, detail = {}) {
    emitted.push(Object.freeze({ type: String(type), ...detail }));
  }

  function play(id, { restart = false } = {}) {
    const sequence = sequenceById(id);
    if (!sequence) throw new RangeError(`Unknown story sequence: ${id}`);
    if (activeSequence?.id === id && !restart) return snapshot();
    if (completedSequences.has(id) && !restart) return snapshot();
    activeSequence = sequence;
    lineIndex = 0;
    lineElapsed = 0;
    sequenceSerial += 1;
    lastEvent = `sequence_started:${id}`;
    return snapshot();
  }

  function finishSequence() {
    if (!activeSequence) return;
    const id = activeSequence.id;
    completedSequences.add(id);
    activeSequence = null;
    lineIndex = 0;
    lineElapsed = 0;
    lastEvent = `sequence_completed:${id}`;
    emit("sequence_completed", { sequenceId: id });
    if (id === STORY_SEQUENCES.homecoming.id) {
      openingCompleted = true;
      phase = STORY_PHASES.MEET_JUNO;
      emit("objective_changed", { phase, targetKey: "garage" });
    } else if (id === STORY_SEQUENCES.garage_briefing.id) {
      briefingCompleted = true;
      phase = STORY_PHASES.RECOVER_COMET;
      emit("start_recovery", { chapterId: CHAPTER.id });
    } else if (id === STORY_SEQUENCES.corrupt_flag.id) {
      phase = STORY_PHASES.ESCAPE_VOSS;
    } else if (id === STORY_SEQUENCES.route_clear.id) {
      phase = STORY_PHASES.RETURN_TO_GARAGE;
    } else if (id === STORY_SEQUENCES.garage_return.id) {
      phase = STORY_PHASES.RESOLUTION;
      activeChoice = EVIDENCE_CHOICE;
      emit("choice_requested", { choiceId: EVIDENCE_CHOICE.id });
    } else if (id === STORY_SEQUENCES.public_release.id || id === STORY_SEQUENCES.protected_case.id) {
      phase = STORY_PHASES.FREE_ROAM;
      chapterCompleted = true;
      emit("chapter_completed", { chapterId: CHAPTER.id, choice: choiceResult });
    }
  }

  function begin() {
    if (chapterStarted) return snapshot();
    chapterStarted = true;
    phase = STORY_PHASES.ARRIVAL;
    lastEvent = "chapter_started";
    emit("chapter_started", { chapterId: CHAPTER.id });
    if (autoBegin) play(STORY_SEQUENCES.homecoming.id);
    return snapshot();
  }

  function notify(event = {}) {
    const type = String(event.type ?? event.kind ?? "");
    lastEvent = type || lastEvent;
    if (type === "capture_started") return begin();
    if (type === "contact_interacted" && phase === STORY_PHASES.MEET_JUNO && !briefingCompleted) {
      phase = STORY_PHASES.BRIEFING;
      return play(STORY_SEQUENCES.garage_briefing.id);
    }
    if (type === "force_recovery") {
      chapterStarted = true;
      openingCompleted = true;
      briefingCompleted = true;
      completedSequences.add(STORY_SEQUENCES.homecoming.id);
      completedSequences.add(STORY_SEQUENCES.garage_briefing.id);
      activeSequence = null;
      phase = STORY_PHASES.RECOVER_COMET;
      return snapshot();
    }
    if (type === "vehicle_recovered" && [STORY_PHASES.RECOVER_COMET, STORY_PHASES.BRIEFING].includes(phase)) {
      phase = STORY_PHASES.ESCAPE_VOSS;
      play(STORY_SEQUENCES.corrupt_flag.id);
    } else if (type === "police_lost" && phase === STORY_PHASES.ESCAPE_VOSS) {
      phase = STORY_PHASES.RETURN_TO_GARAGE;
      play(STORY_SEQUENCES.route_clear.id);
    } else if (type === "vehicle_delivered" && !chapterCompleted) {
      phase = STORY_PHASES.RESOLUTION;
      play(STORY_SEQUENCES.garage_return.id);
    } else if (type === "target_destroyed") {
      phase = briefingCompleted ? STORY_PHASES.RECOVER_COMET : STORY_PHASES.MEET_JUNO;
      activeSequence = null;
      emit("recovery_failed", { reason: "customer_vehicle_destroyed" });
    }
    return snapshot();
  }

  function advanceLine() {
    if (!activeSequence) return snapshot();
    lineIndex += 1;
    lineElapsed = 0;
    if (lineIndex >= activeSequence.lines.length) finishSequence();
    return snapshot();
  }

  function choose(optionValue) {
    if (!activeChoice) return snapshot();
    const option = activeChoice.options.find(value => value.id === String(optionValue ?? ""));
    if (!option) throw new RangeError(`Unknown story choice option: ${optionValue}`);
    choiceResult = option.id;
    publicPressure += option.pressure;
    sourceSafety += option.sourceSafety;
    activeChoice = null;
    lastEvent = `choice_made:${option.id}`;
    emit("choice_made", {
      choiceId: EVIDENCE_CHOICE.id,
      optionId: option.id,
      publicPressure,
      sourceSafety,
    });
    return play(option.sequenceId);
  }

  function update(deltaValue, { advance = false, skip = false } = {}) {
    const delta = Math.max(0, Math.min(0.25, Number(deltaValue) || 0));
    storyElapsed += delta;
    if (!activeSequence) return snapshot();
    if (skip) {
      finishSequence();
      return snapshot();
    }
    lineElapsed += delta;
    const current = activeSequence.lines[lineIndex];
    const playerAdvanced = advance && lineElapsed >= 0.32;
    if (playerAdvanced || lineElapsed + 1e-9 >= current.duration) advanceLine();
    return snapshot();
  }

  function objective() {
    switch (phase) {
      case STORY_PHASES.ARRIVAL: return "LISTEN TO JUNO";
      case STORY_PHASES.MEET_JUNO: return "WALK TO PULSE GARAGE AND TALK TO JUNO";
      case STORY_PHASES.BRIEFING: return "HEAR JUNO AND RIN OUT";
      case STORY_PHASES.RECOVER_COMET: return "RECOVER MARISOL'S COMET FROM THE VOSS IMPOUND";
      case STORY_PHASES.ESCAPE_VOSS: return "GET CLEAR WITHOUT HURTING ANYONE";
      case STORY_PHASES.RETURN_TO_GARAGE: return "RETURN MARISOL'S COMET AND THE AUDIT DRIVE";
      case STORY_PHASES.RESOLUTION: return activeChoice ? "DECIDE WHAT JUSTICE COSTS" : "FACE THE CONSEQUENCES";
      case STORY_PHASES.FREE_ROAM: return choiceResult === "publish"
        ? "LIVE WITH THE LEAK — PROTECT THE PEOPLE IT EXPOSED"
        : choiceResult === "protect"
          ? "BUILD THE CASE — DO NOT LET CAUTION BECOME SILENCE"
          : "LIVE YOUR LIFE — WORK, EXPLORE, HELP THE NEIGHBOURHOOD";
      default: return "HOME AGAIN";
    }
  }

  function targetKey() {
    if (phase === STORY_PHASES.MEET_JUNO || phase === STORY_PHASES.RETURN_TO_GARAGE) return "garage";
    if (phase === STORY_PHASES.RECOVER_COMET || phase === STORY_PHASES.ESCAPE_VOSS) return "comet";
    return null;
  }

  function drainEvents() {
    return emitted.splice(0, emitted.length);
  }

  function save() {
    return {
      version: STORY_SAVE_VERSION,
      phase,
      activeSequenceId: activeSequence?.id ?? null,
      lineIndex,
      lineElapsed,
      storyElapsed,
      chapterStarted,
      chapterCompleted,
      briefingCompleted,
      openingCompleted,
      sequenceSerial,
      activeChoiceId: activeChoice?.id ?? null,
      choiceResult,
      publicPressure,
      sourceSafety,
      completedSequences: [...completedSequences],
      lastEvent,
    };
  }

  function restore(value = {}) {
    phase = validPhase(value.phase);
    activeSequence = sequenceById(value.activeSequenceId);
    lineIndex = activeSequence
      ? Math.max(0, Math.min(activeSequence.lines.length - 1, Math.trunc(Number(value.lineIndex) || 0)))
      : 0;
    lineElapsed = Math.max(0, Number(value.lineElapsed) || 0);
    storyElapsed = Math.max(0, Number(value.storyElapsed) || 0);
    chapterStarted = Boolean(value.chapterStarted);
    chapterCompleted = Boolean(value.chapterCompleted);
    briefingCompleted = Boolean(value.briefingCompleted);
    openingCompleted = Boolean(value.openingCompleted);
    sequenceSerial = Math.max(0, Math.trunc(Number(value.sequenceSerial) || 0));
    activeChoice = value.activeChoiceId === EVIDENCE_CHOICE.id ? EVIDENCE_CHOICE : null;
    choiceResult = EVIDENCE_CHOICE.options.some(option => option.id === value.choiceResult) ? value.choiceResult : null;
    publicPressure = Number.isFinite(Number(value.publicPressure)) ? Number(value.publicPressure) : 0;
    sourceSafety = Number.isFinite(Number(value.sourceSafety)) ? Number(value.sourceSafety) : 0;
    completedSequences.clear();
    for (const id of value.completedSequences ?? []) if (sequenceById(id)) completedSequences.add(String(id));
    lastEvent = value.lastEvent ? String(value.lastEvent) : null;
    emitted.length = 0;
    return snapshot();
  }

  function snapshot() {
    const current = activeSequence?.lines[lineIndex] ?? null;
    return Object.freeze({
      chapter: CHAPTER,
      phase,
      objective: objective(),
      targetKey: targetKey(),
      chapterStarted,
      chapterCompleted,
      openingCompleted,
      briefingCompleted,
      active: Boolean(activeSequence || activeChoice),
      cinematic: Boolean(activeSequence?.cinematic || activeChoice),
      controlsLocked: Boolean(activeSequence?.cinematic || activeChoice),
      sequenceId: activeSequence?.id ?? null,
      sequenceSerial,
      lineIndex: activeSequence ? lineIndex : null,
      lineCount: activeSequence?.lines.length ?? 0,
      line: current ? Object.freeze({
        ...current,
        elapsed: lineElapsed,
        progress: Math.max(0, Math.min(1, lineElapsed / current.duration)),
      }) : null,
      titleCard: activeSequence?.titleCard ?? null,
      choice: activeChoice ? Object.freeze({
        id: activeChoice.id,
        prompt: activeChoice.prompt,
        options: activeChoice.options,
      }) : null,
      choiceResult,
      moralLedger: Object.freeze({ publicPressure, sourceSafety }),
      elapsed: storyElapsed,
      completedSequences: Object.freeze([...completedSequences]),
      lastEvent,
    });
  }

  return { begin, notify, update, advanceLine, choose, play, drainEvents, save, restore, snapshot };
}
