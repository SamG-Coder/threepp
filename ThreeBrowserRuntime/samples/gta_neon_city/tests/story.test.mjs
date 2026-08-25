import test from "node:test";
import assert from "node:assert/strict";
import { STORY_PHASES, createStoryCampaign } from "../src/game/story.mjs";

function finishActive(story) {
  let guard = 0;
  while (story.snapshot().line && guard++ < 64) story.update(0, { advance: true, skip: true });
}

test("chapter one gives the recovery a lawful, character-driven reason", () => {
  const story = createStoryCampaign();
  story.notify({ type: "capture_started" });
  assert.equal(story.snapshot().sequenceId, "homecoming");
  assert.match(story.snapshot().line.text, /PULSE STREET/i);
  story.update(0, { skip: true });
  assert.equal(story.snapshot().phase, STORY_PHASES.MEET_JUNO);
  assert.match(story.snapshot().objective, /PULSE GARAGE/i);

  story.notify({ type: "contact_interacted" });
  assert.equal(story.snapshot().cinematic, true);
  const completeDialogue = story.snapshot().sequenceId;
  assert.equal(completeDialogue, "garage_briefing");
  const briefingText = [];
  while (story.snapshot().active) {
    briefingText.push(story.snapshot().line.text);
    story.advanceLine();
  }
  assert.match(briefingText.join(" "), /registration is clean/i);
  assert.match(briefingText.join(" "), /returning a customer's car/i);
  assert.match(briefingText.join(" "), /do not hurt anyone/i);
  assert.equal(story.snapshot().phase, STORY_PHASES.RECOVER_COMET);
  assert.ok(story.drainEvents().some(event => event.type === "start_recovery"));
});

test("recovery, corrupt police flag, return, and resolution form one coherent chapter", () => {
  const story = createStoryCampaign({ autoBegin: false });
  story.notify({ type: "force_recovery" });
  story.notify({ type: "vehicle_recovered" });
  assert.equal(story.snapshot().phase, STORY_PHASES.ESCAPE_VOSS);
  assert.equal(story.snapshot().cinematic, false, "radio dialogue must not take away driving control");
  finishActive(story);
  story.notify({ type: "police_lost" });
  assert.equal(story.snapshot().phase, STORY_PHASES.RETURN_TO_GARAGE);
  finishActive(story);
  story.notify({ type: "vehicle_delivered" });
  assert.equal(story.snapshot().sequenceId, "garage_return");
  assert.equal(story.snapshot().controlsLocked, true);
  finishActive(story);
  assert.equal(story.snapshot().phase, STORY_PHASES.RESOLUTION);
  assert.equal(story.snapshot().choice.id, "audit_drive_release");
  assert.match(story.snapshot().choice.prompt, /people Voss coerced/i);
  story.choose("publish");
  assert.equal(story.snapshot().sequenceId, "public_release");
  finishActive(story);
  assert.equal(story.snapshot().phase, STORY_PHASES.FREE_ROAM);
  assert.equal(story.snapshot().chapterCompleted, true);
  assert.equal(story.snapshot().choiceResult, "publish");
  assert.deepEqual(story.snapshot().moralLedger, { publicPressure: 3, sourceSafety: -2 });
  assert.match(story.snapshot().objective, /people it exposed/i);
});

test("the evidence decision has durable costs on both branches", () => {
  const reachChoice = story => {
    story.notify({ type: "force_recovery" });
    story.notify({ type: "vehicle_delivered" });
    finishActive(story);
    assert.ok(story.snapshot().choice);
  };

  const publish = createStoryCampaign({ autoBegin: false });
  reachChoice(publish);
  assert.throws(() => publish.choose("perfect_answer"), /Unknown story choice/);
  publish.choose("publish");
  const publishLines = [];
  while (publish.snapshot().line) {
    publishLines.push(publish.snapshot().line.text);
    publish.advanceLine();
  }
  assert.match(publishLines.join(" "), /stopped his vote/i);
  assert.match(publishLines.join(" "), /who could testify/i);

  const protect = createStoryCampaign({ autoBegin: false });
  reachChoice(protect);
  protect.choose("protect");
  const protectedLines = [];
  while (protect.snapshot().line) {
    protectedLines.push(protect.snapshot().line.text);
    protect.advanceLine();
  }
  assert.deepEqual(protect.snapshot().moralLedger, { publicPressure: -1, sourceSafety: 3 });
  assert.match(protectedLines.join(" "), /keeps the harbour contract/i);
  assert.match(protect.snapshot().objective, /caution become silence/i);
});

test("story save and restore preserve the exact dialogue beat without replaying emitted commands", () => {
  const story = createStoryCampaign();
  story.notify({ type: "capture_started" });
  story.update(1.1);
  story.drainEvents();
  const saved = story.save();
  const restored = createStoryCampaign();
  restored.restore(saved);
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.drainEvents(), []);
});
