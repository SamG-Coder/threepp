import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_SKILL_MAP,
  HOME_CARE_ACTIONS,
  LIFE_PROFILE_LIMITS,
  LIFE_PROFILE_SAVE_VERSION,
  LIFE_SKILL_DEFINITIONS,
  LIFE_SKILL_LEVEL_THRESHOLDS,
  LIFE_SKILLS,
  createLifeProfile,
  skillWeightsForActivity,
} from "../src/game/life-profile.mjs";

function assertDeepFrozenFinite(value, path = "snapshot", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozenFinite(child, `${path}.${key}`, seen);
}

test("the life profile exposes deterministic mechanic and broader ordinary-life skills", () => {
  assert.deepEqual(Object.values(LIFE_SKILLS), [
    "mechanics", "driving", "fitness", "photography", "community", "hospitality",
  ]);
  assert.equal(LIFE_SKILL_DEFINITIONS.length, 6);
  assert.equal(new Set(LIFE_SKILL_DEFINITIONS.map(skill => skill.id)).size, 6);
  assert.ok(LIFE_SKILL_DEFINITIONS.every(skill => skill.wageStep > 0));
  assert.deepEqual(LIFE_SKILL_LEVEL_THRESHOLDS, [0, 100, 280, 600, 1_050, 1_650]);
  assert.ok(Object.isFrozen(ACTIVITY_SKILL_MAP));
  assert.ok(Object.isFrozen(ACTIVITY_SKILL_MAP.garage_apprentice));
  assert.deepEqual(skillWeightsForActivity("garage_apprentice"), [
    { skillId: "mechanics", weight: 0.85 },
    { skillId: "hospitality", weight: 0.15 },
  ]);
  assert.deepEqual(skillWeightsForActivity("community_kitchen"), [
    { skillId: "hospitality", weight: 2 / 3 },
    { skillId: "community", weight: 1 / 3 },
  ]);
  assert.deepEqual(skillWeightsForActivity("repair_cafe"), [
    { skillId: "mechanics", weight: 0.75 },
    { skillId: "community", weight: 0.25 },
  ]);
  assert.deepEqual(skillWeightsForActivity("local_archive"), [
    { skillId: "photography", weight: 0.65 },
    { skillId: "community", weight: 0.35 },
  ]);
  assert.deepEqual(skillWeightsForActivity("mina_market_shift"), [
    { skillId: "hospitality", weight: 28 / 68 },
    { skillId: "community", weight: 22 / 68 },
    { skillId: "fitness", weight: 18 / 68 },
  ]);
  assert.deepEqual(skillWeightsForActivity("not_a_job"), []);
});

test("Harbour Skills House shifts flow through the same wage and XP ledger", () => {
  const profile = createLifeProfile();
  const cases = [
    ["community_kitchen", ["hospitality", "community"]],
    ["repair_cafe", ["mechanics", "community"]],
    ["local_archive", ["photography", "community"]],
  ];
  for (const [activityId, expectedSkills] of cases) {
    const result = profile.recordShift({
      id: `harbour-skills:${activityId}:day-4`,
      activityId,
      dayIndex: 4,
      durationMinutes: 90,
      quality: 0.82,
      baseWage: 60,
      experience: 40,
    });
    assert.equal(result.accepted, true);
    assert.deepEqual(result.awards.map(award => award.skillId), expectedSkills);
    assert.equal(result.wage > 0, true);
  }
  assert.equal(profile.snapshot().shiftsCompleted, 3);
  assert.equal(profile.snapshot().activityCounts.community_kitchen, 1);
  assert.equal(profile.snapshot().activityCounts.repair_cafe, 1);
  assert.equal(profile.snapshot().activityCounts.local_archive, 1);
});

test("experience levels and mapped awards are deterministic and source-idempotent", () => {
  const profile = createLifeProfile();
  let result = profile.awardActivityExperience("garage_apprentice", 101, { sourceId: "repair-order-1" });
  assert.equal(result.accepted, true);
  assert.equal(result.experience, 101);
  assert.deepEqual(result.awards.map(award => [award.skillId, award.experience]), [
    ["mechanics", 86],
    ["hospitality", 15],
  ]);
  assert.equal(profile.skill("mechanics").level, 1);
  assert.equal(profile.skill("mechanics").experienceToNextLevel, 14);
  assert.equal(profile.snapshot().activityCounts.garage_apprentice, 1);

  result = profile.awardActivityExperience("garage_apprentice", 101, { sourceId: "repair-order-1" });
  assert.deepEqual(result, {
    accepted: false,
    reason: "duplicate_source",
    activityId: "garage_apprentice",
    sourceId: "repair-order-1",
    experience: 0,
    awards: [],
  });
  assert.equal(profile.skill("mechanics").experience, 86);

  profile.awardExperience("mechanics", 14, { sourceId: "training-manual-1" });
  assert.equal(profile.skill("mechanics").level, 2);
  assert.equal(profile.skill("mechanics").levelName, "CAPABLE");
  assert.equal(profile.skill("mechanics").nextLevelExperience, 280);
  assert.throws(() => profile.awardExperience("alchemy", 10), /Unknown life skill/);
  assert.equal(profile.awardActivityExperience("unknown", 50).reason, "unmapped_activity");
});

test("skill levels produce modest deterministic wage quotes without mutating cash", () => {
  const profile = createLifeProfile();
  const base = profile.quoteWage("garage_apprentice", 240, 0.75);
  assert.deepEqual(base, {
    activityId: "garage_apprentice",
    baseWage: 240,
    quality: 0.75,
    wageMultiplier: 1,
    qualityMultiplier: 1.05,
    wage: 252,
  });

  profile.awardExperience("mechanics", 600, { sourceId: "college-module" });
  profile.awardExperience("hospitality", 100, { sourceId: "customer-care-module" });
  const experienced = profile.quoteWage("garage_apprentice", 240, 0.75);
  assert.ok(experienced.wageMultiplier > base.wageMultiplier);
  assert.ok(experienced.wage > base.wage);
  assert.equal(profile.wageMultiplier("unmapped"), 1);
  assertDeepFrozenFinite(experienced);
});

test("recorded shifts own exact one-shot wages, XP, bounded history, and activity counts", () => {
  const profile = createLifeProfile();
  const first = profile.recordShift({
    id: "garage-day-7-order-2",
    activityId: "garage_apprentice",
    dayIndex: 7,
    durationMinutes: 120,
    quality: 0.9,
    baseWage: 260,
    experience: 80,
  });
  assert.equal(first.accepted, true);
  assert.equal(first.serial, 1);
  assert.equal(first.wage, 281);
  assert.equal(first.experience, 80);
  assert.deepEqual(first.awards, [
    { skillId: "mechanics", experience: 68 },
    { skillId: "hospitality", experience: 12 },
  ]);
  assert.equal(profile.snapshot().activityCounts.garage_apprentice, 1);
  assert.equal(profile.snapshot().shiftsCompleted, 1);

  const duplicate = profile.recordShift({
    id: "garage-day-7-order-2",
    activityId: "garage_apprentice",
    baseWage: 9_999,
  });
  assert.deepEqual(duplicate, {
    accepted: false,
    reason: "duplicate_shift",
    id: "garage-day-7-order-2",
    wage: 0,
    experience: 0,
  });
  assert.equal(profile.snapshot().shiftSerial, 1);
  assert.equal(profile.skill("mechanics").experience, 68);

  for (let index = 0; index < LIFE_PROFILE_LIMITS.maxShiftHistory + 4; ++index) {
    assert.equal(profile.recordShift({
      id: `parcel-day-${index}`,
      activityId: "pulse_parcels",
      dayIndex: 8 + index,
      durationMinutes: 45,
      quality: 0.7,
      baseWage: 100,
      experience: 1,
    }).accepted, true);
  }
  const state = profile.snapshot();
  assert.equal(state.shiftHistory.length, LIFE_PROFILE_LIMITS.maxShiftHistory);
  assert.equal(state.shiftHistory.at(-1).id, `parcel-day-${LIFE_PROFILE_LIMITS.maxShiftHistory + 3}`);
  assert.equal(state.shiftsCompleted, LIFE_PROFILE_LIMITS.maxShiftHistory + 5);
  assertDeepFrozenFinite(state);
});

test("Mina Market keeps its caller-owned wage exact while sharing deterministic life-skill XP", () => {
  const profile = createLifeProfile();
  const result = profile.recordShift({
    id: "mina-market-wage:2:1",
    activityId: "mina_market_shift",
    dayIndex: 2,
    durationMinutes: 237,
    quality: 1,
    baseWage: 9_999,
    exactWage: 90,
    experience: 68,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.wage, 90);
  assert.equal(result.baseWage, 90);
  assert.equal(result.wageMultiplier, 1);
  assert.equal(result.qualityMultiplier, 1);
  assert.deepEqual(result.awards, [
    { skillId: "hospitality", experience: 28 },
    { skillId: "community", experience: 22 },
    { skillId: "fitness", experience: 18 },
  ]);
  assert.equal(profile.snapshot().activityCounts.mina_market_shift, 1);
  assert.deepEqual(profile.recordShift({
    id: "mina-market-wage:2:1",
    activityId: "mina_market_shift",
    exactWage: 9_999,
  }), {
    accepted: false,
    reason: "duplicate_shift",
    id: "mina-market-wage:2:1",
    wage: 0,
    experience: 0,
  });
});

test("energy and hygiene are gentle non-lethal needs with caller-owned home-care transactions", () => {
  const profile = createLifeProfile({ initialEnergy: 20, initialHygiene: 12 });
  const before = profile.snapshot();
  assert.equal(before.needs.safe, true);
  assert.equal(before.needs.energyStatus, "TIRED");
  assert.equal(before.needs.hygieneStatus, "NEEDS CARE");

  for (let index = 0; index < 100; ++index) profile.update(1, { working: true, captureSnapshot: false });
  const worn = profile.snapshot();
  assert.ok(worn.needs.energy < before.needs.energy);
  assert.ok(worn.needs.hygiene < before.needs.hygiene);
  assert.ok(worn.needs.staminaRecoveryMultiplier >= 0.8);
  assert.equal(profile.performHomeCare("shower", { atHome: false, cash: 100 }).reason, "home_required");
  assert.equal(profile.performHomeCare("shower", { atHome: true, cash: 1 }).reason, "insufficient_cash");

  const shower = profile.performHomeCare("shower", {
    atHome: true,
    cash: 100,
    dayIndex: 3,
    sourceId: "home-day-3-shower",
  });
  assert.equal(shower.accepted, true);
  assert.equal(shower.cost, 2, "the caller applies this cost; profile never owns cash");
  assert.equal(profile.snapshot().needs.hygiene, 100);
  assert.equal(profile.performHomeCare("shower", {
    atHome: true,
    cash: 100,
    dayIndex: 3,
    sourceId: "home-day-3-shower",
  }).reason, "duplicate_source");

  const meal = profile.performHomeCare("cook_meal", { atHome: true, cash: 100, dayIndex: 3 });
  assert.equal(meal.experience, 12);
  assert.equal(meal.skillId, LIFE_SKILLS.HOSPITALITY);
  const secondMeal = profile.performHomeCare("cook_meal", { atHome: true, cash: 100, dayIndex: 3 });
  assert.equal(secondMeal.accepted, true);
  assert.equal(secondMeal.experience, 0, "repeat chores help needs but cannot farm same-day XP");
  const nextDayMeal = profile.performHomeCare("cook_meal", { atHome: true, cash: 100, dayIndex: 4 });
  assert.equal(nextDayMeal.experience, 12);
  assert.equal(profile.snapshot().homeCareCounts.cook_meal, 3);
  assert.ok(HOME_CARE_ACTIONS.some(action => action.id === "laundry"));
  assert.ok(HOME_CARE_ACTIONS.some(action => action.id === "tidy_up"));

  const householdEffect = profile.applyNeedEffects({ energy: -500, hygiene: 13.5 });
  assert.equal(householdEffect.accepted, true);
  assert.equal(householdEffect.energy <= 0, true);
  assert.equal(profile.snapshot().needs.energy, 0, "external household effects remain non-lethal and clamped");
  assert.equal(profile.snapshot().needs.hygiene <= 100, true);
  assertDeepFrozenFinite(householdEffect);
});

test("current saves restore bit-for-bit and retain exactly-once ledgers", () => {
  const source = createLifeProfile({ initialEnergy: 63, initialHygiene: 59 });
  source.update(0.75, { working: true });
  source.awardActivityExperience("city_lens", 77, { sourceId: "photo-walk-9" });
  source.recordShift({
    id: "garage-day-9",
    activityId: "garage_apprentice",
    dayIndex: 9,
    durationMinutes: 105,
    quality: 0.84,
    baseWage: 250,
  });
  source.performHomeCare("laundry", {
    atHome: true,
    cash: 100,
    dayIndex: 9,
    sourceId: "laundry-day-9",
  });
  const saved = JSON.parse(JSON.stringify(source.save()));
  assert.equal(saved.version, LIFE_PROFILE_SAVE_VERSION);

  const restored = createLifeProfile();
  restored.restore(saved);
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.snapshot(), source.snapshot());
  assert.equal(restored.recordShift({ id: "garage-day-9", activityId: "garage_apprentice" }).reason, "duplicate_shift");
  assert.equal(restored.awardActivityExperience("city_lens", 77, { sourceId: "photo-walk-9" }).reason, "duplicate_source");
});

test("version-one saves migrate safely and hostile current values are sanitized", () => {
  const profile = createLifeProfile();
  const migrated = profile.restore({
    version: 1,
    elapsed: 42,
    energy: 61,
    hygiene: 57,
    experience: {
      mechanics: { experience: 280 },
      driving: 100,
      removed_skill: 99_999,
    },
    activities: { garage_apprentice: 2 },
    shifts: [{
      shiftId: "legacy-garage-2",
      serial: 2,
      activityId: "garage_apprentice",
      dayIndex: 2,
      durationMinutes: 60,
      quality: 0.8,
      baseWage: 200,
      wageMultiplier: 1,
      qualityMultiplier: 1.06,
      wage: 212,
      experience: 50,
      awards: [{ skillId: "mechanics", experience: 43 }, { skillId: "removed", experience: 7 }],
      completedAt: 41,
    }],
  });
  assert.equal(migrated.skills.find(skill => skill.id === "mechanics").level, 3);
  assert.equal(migrated.skills.find(skill => skill.id === "driving").level, 2);
  assert.equal(migrated.activityCounts.garage_apprentice, 2);
  assert.equal(migrated.shiftHistory[0].id, "legacy-garage-2");
  assert.deepEqual(migrated.shiftHistory[0].awards, [{ skillId: "mechanics", experience: 43 }]);

  const hostile = profile.restore({
    ...profile.save(),
    elapsed: Infinity,
    needs: { energy: Infinity, hygiene: -Infinity },
    skills: { mechanics: Infinity, driving: -20 },
    shiftSerial: Infinity,
    shiftHistory: [null, { id: "", serial: Infinity }, { id: "safe", serial: 1, quality: Infinity }],
    recordedShiftIds: [null, "", "safe", "safe"],
    lastHomeCare: { actionId: "invented", serial: Infinity },
  });
  assertDeepFrozenFinite(hostile);
  assert.ok(hostile.needs.energy >= 0 && hostile.needs.energy <= 100);
  assert.ok(hostile.needs.hygiene >= 0 && hostile.needs.hygiene <= 100);
  assert.equal(hostile.shiftHistory.length, 1);
  assert.throws(() => profile.restore({ version: LIFE_PROFILE_SAVE_VERSION + 1 }), /Unsupported life profile/);
  assert.throws(() => profile.restore({}), /Unsupported life profile/);
});

test("RAM-only prewarm covers skills, shifts, home actions, and restore without touching live state", () => {
  const profile = createLifeProfile();
  profile.awardActivityExperience("garage_apprentice", 93, { sourceId: "live-repair" });
  profile.update(1, { working: true });
  const before = profile.save();
  const beforeBits = JSON.stringify(before);
  const prepared = profile.prewarm();
  assert.equal(prepared.ready, true);
  assert.equal(prepared.storage, "memory-only");
  assert.equal(prepared.rendererResources, 0);
  assert.equal(prepared.diskResources, 0);
  assert.equal(prepared.activitiesPrepared, Object.keys(ACTIVITY_SKILL_MAP).length);
  assert.equal(prepared.shiftsPrepared, Object.keys(ACTIVITY_SKILL_MAP).length);
  assert.equal(prepared.homeActionsPrepared, HOME_CARE_ACTIONS.length);
  assert.equal(prepared.saveRestorePrepared, Object.keys(ACTIVITY_SKILL_MAP).length);
  assert.equal(prepared.liveStatePreserved, true);
  assert.equal(JSON.stringify(profile.save()), beforeBits);
  assert.deepEqual(profile.save(), before);
  assertDeepFrozenFinite(prepared);
});
