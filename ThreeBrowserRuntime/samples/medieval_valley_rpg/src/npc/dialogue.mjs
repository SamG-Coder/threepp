import { emitEvent } from "../player/runtime-contracts.mjs";

export const DIALOGUE_TREES = Object.freeze({
  elder: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.55 }, text: "To the chapel, all of you. Rusk will hold the square." },
    { id: "return-victory", when: { questStage: ["light_against_the_dark", "return_to_village"] }, text: "The shadow has lifted from the keep. Come—let the village hear what you did." },
    { id: "warden", when: { worldFlag: "wardenDefeated" }, text: "I felt the old wards break. The Warden is truly gone." },
    { id: "signal", when: { questStage: ["light_against_the_dark", "follow_signal"] }, text: "Follow the beam north. It will reveal the fortress road where the fog once hid it." },
    { id: "light", when: { questStage: ["light_against_the_dark", "light_beacon"] }, text: "Everything is ready. Climb the beacon and give the valley its flame." },
    { id: "introduction", when: { questStage: ["light_against_the_dark", "speak_to_elder"] }, text: "Our beacon is broken and the fortress stirs. Help us restore the light before nightfall." },
    { id: "default", text: "The valley remembers every light kindled against the dark." },
  ]),
  hunter: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.55 }, text: "Wolves in the village. Move—talk when the square is clear." },
    { id: "resin", when: { questStage: ["light_against_the_dark", "obtain_resin"] }, text: "Old pines bleed the resin you need. Take the north road, turn east at the cairns, and watch for corrupted wolves." },
    { id: "den-clear", when: { worldFlag: "wolfDenCleared" }, text: "The forest is quieter since you broke the den heart. Animals will return by dawn." },
    { id: "default", text: "Tracks are honest. Around here, people and weather are harder to read." },
  ]),
  merchant: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.55 }, text: "Forget the stock. Get me behind the inn doors!" },
    { id: "road-return", when: { questStage: ["roads_of_trade", "report_safe_road"] }, text: "You cleared it? Then the next caravan can finally reach us." },
    { id: "road", when: { questStage: ["roads_of_trade", "find_wolf_den"] }, text: "My cart is stranded south of the wolf den. Clear the road and I can restock the market." },
    { id: "open", when: { worldFlag: "merchantRouteOpen" }, text: "The road is open and the shelves are full. You have my best price.", shop: "improved-provisions" },
    { id: "default", text: "Very little reaches the valley while wolves hold the road.", shop: "limited-provisions" },
  ]),
  blacksmith: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.65 }, text: "Steel later. Get behind the guard line now." },
    { id: "warden-dead", when: { worldFlag: "wardenDefeated" }, text: "You brought the old road back from the dead. My best steel is yours at cost.", unlock: "master-smithing" },
    { id: "beacon-parts", when: { questStage: ["light_against_the_dark", "obtain_iron_fittings"], notFlag: "ironFittingsDelivered" }, text: "For the beacon fittings I need three iron scraps. Bring them and I will shape the braces.", offer: "beacon-iron-fittings" },
    { id: "trusted", when: { reputationAtLeast: 25 }, text: "You have earned Vale prices. I can temper two-handed blades now.", unlock: "tempered-weapons" },
    { id: "default", text: "The forge is hot while daylight holds. Need repairs, iron, or a sharper edge?", shop: "blacksmith" },
  ]),
  innkeeper: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.55 }, text: "Cellar door is open. Civilians first—move!" },
    { id: "night", when: { hourBetween: [19, 5] }, text: "Beds are dry, stew is warm, and every traveller has a fortress tale.", shop: "inn" },
    { id: "route-open", when: { worldFlag: "merchantRouteOpen" }, text: "The caravan made it through. Proper provisions are back on the shelf.", shop: "improved-provisions" },
    { id: "default", text: "News travels faster than carts. Ask around before taking the north road." },
  ]),
  healer: Object.freeze([
    { id: "wounded", when: { playerHealthBelow: 0.55 }, text: "Sit. Pride will not close that wound.", service: "healing" },
    { id: "storm", when: { weatherIs: ["storm", "heavy-rain"] }, text: "The storm carries strange ash from the fortress. Keep your face covered." },
    { id: "beacon", when: { worldFlag: "beaconLit" }, text: "The beacon burns again. Even the shrine feels warmer." },
    { id: "default", text: "Bring valley herbs and I can prepare salves for the road.", offer: "gather-healing-herbs" },
  ]),
  guardCaptain: Object.freeze([
    { id: "hostile", when: { reputationBelow: -20 }, text: "Hands where I can see them. One more offence and you leave in irons." },
    { id: "danger", when: { awarenessAtLeast: 0.5 }, text: "Enemy inside the boundary! Rally at the beacon square." },
    { id: "warden", when: { worldFlag: "wardenDefeated" }, text: "The Warden is down. I will put your name above the gate." },
    { id: "beacon", when: { worldFlag: "beaconLit" }, text: "With the beacon lit, patrols can see the whole north road." },
    { id: "default", text: "Wolves probe the fields at dusk. The fortress things follow after dark.", offer: "clear-the-east-road" },
  ]),
  farmerMerchant: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.5 }, text: "Leave the baskets—get to the farmhouse!" },
    { id: "rain", when: { weatherIs: ["rain", "storm", "heavy-rain"] }, text: "Good for roots, bad for the bridge. Orren will be checking the pilings." },
    { id: "trusted", when: { reputationAtLeast: 15 }, text: "You kept the fields safe. Take the neighbour's price.", shop: "farm-discount" },
    { id: "default", text: "Fresh roots, flour, lamp oil. Limited stock until the road is safe.", shop: "farm-stall" },
  ]),
  miller: Object.freeze([
    { id: "danger", when: { awarenessAtLeast: 0.5 }, text: "If they reach the wheel, the village loses its flour. Warn Rusk!" },
    { id: "river", when: { weatherIs: ["storm", "heavy-rain"] }, text: "River is climbing. I have tied the wheel, but the bridge may go." },
    { id: "route-open", when: { worldFlag: "merchantRouteOpen" }, text: "Carts are moving again. Tomas will have bread enough for everyone." },
    { id: "default", text: "The wheel tells me when weather is changing, hours before the clouds do." },
  ]),
});

function questStatus(context, id) {
  try {
    const direct = typeof context.quests?.status === "function" ? context.quests.status(id) : context.quests?.status?.[id];
    return direct ?? context.quests?.get?.(id)?.status ?? context.questStates?.[id]?.status ?? context.questStates?.[id] ?? null;
  } catch {
    return context.questStates?.[id]?.status ?? context.questStates?.[id] ?? null;
  }
}

function questStage(context, id) {
  try {
    return context.quests?.get?.(id)?.stageId ?? context.questStates?.[id]?.stageId ?? null;
  } catch {
    return context.questStates?.[id]?.stageId ?? null;
  }
}

function flagValue(context, key) {
  return context.worldState?.get?.(key) ?? context.worldState?.[key] ?? context.worldState?.progress?.[key] ?? context.flags?.[key] ?? false;
}

export function evaluateCondition(condition, context = {}) {
  if (!condition) return true;
  if (typeof condition === "function") return Boolean(condition(context));
  if (Array.isArray(condition)) return condition.every(item => evaluateCondition(item, context));
  if (condition.all && !condition.all.every(item => evaluateCondition(item, context))) return false;
  if (condition.any && !condition.any.some(item => evaluateCondition(item, context))) return false;
  if (condition.not && evaluateCondition(condition.not, context)) return false;
  if (condition.questActive && !["active", "in-progress"].includes(questStatus(context, condition.questActive))) return false;
  if (condition.questComplete && !["complete", "completed"].includes(questStatus(context, condition.questComplete))) return false;
  if (condition.questStage) {
    const [questId, stageId] = condition.questStage;
    if (questStage(context, questId) !== stageId) return false;
  }
  if (condition.worldFlag && !flagValue(context, condition.worldFlag)) return false;
  if (condition.notFlag && flagValue(context, condition.notFlag)) return false;
  const reputation = Number(context.reputation ?? context.player?.reputation ?? 0);
  if (condition.reputationAtLeast != null && reputation < condition.reputationAtLeast) return false;
  if (condition.reputationBelow != null && reputation >= condition.reputationBelow) return false;
  if (condition.awarenessAtLeast != null && Number(context.npc?.awareness ?? 0) < condition.awarenessAtLeast) return false;
  if (condition.playerHealthBelow != null) {
    const health = Number(context.player?.stats?.health ?? 1);
    const maximum = Math.max(1, Number(context.player?.stats?.maxHealth ?? 1));
    if (health / maximum >= condition.playerHealthBelow) return false;
  }
  if (condition.weatherIs) {
    const weather = String(context.weather?.type ?? context.weather ?? "clear").toLowerCase();
    if (!condition.weatherIs.map(String).map(value => value.toLowerCase()).includes(weather)) return false;
  }
  if (condition.hourBetween) {
    const [start, end] = condition.hourBetween;
    const hour = ((Number(context.hour ?? 12) % 24) + 24) % 24;
    const inside = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!inside) return false;
  }
  if (condition.activityIs && context.npc?.activity !== condition.activityIs) return false;
  if (condition.hasItem && !(context.inventory?.has?.(condition.hasItem) ?? context.player?.inventory?.has?.(condition.hasItem))) return false;
  return true;
}

export class DialogueService {
  constructor({ services = {}, world = null, events = services?.events, trees = DIALOGUE_TREES } = {}) {
    this.services = services;
    this.world = world;
    this.events = events;
    this.trees = trees;
  }

  context(npc, player, overrides = {}) {
    const weatherCurrent = typeof this.services?.weather?.current === "function"
      ? this.services.weather.current() : this.services?.weather?.current ?? this.services?.weather?.type;
    const timeHour = typeof this.services?.time?.hour === "function"
      ? this.services.time.hour() : this.services?.time?.hour ?? this.services?.time?.timeOfDay;
    return {
      npc,
      player,
      quests: this.services?.quests,
      questStates: this.services?.quests?.states,
      worldState: this.services?.worldState ?? this.services?.progress ?? this.world?.state,
      inventory: this.services?.inventory ?? player?.inventory,
      reputation: this.services?.reputation?.get?.(npc?.role === "guard" ? "guards" : npc?.role === "hunter" ? "hunters" : "village") ?? player?.reputation ?? 0,
      weather: weatherCurrent ?? this.world?.weather ?? "clear",
      hour: timeHour ?? this.world?.time?.hour ?? 12,
      ...overrides,
    };
  }

  begin(npc, player, overrides = {}) {
    const context = this.context(npc, player, overrides);
    const tree = this.trees[npc?.dialogueId ?? npc?.definition?.dialogue] ?? [];
    const node = tree.find(candidate => evaluateCondition(candidate.when, context)) ?? tree.at(-1) ?? { id: "silent", text: "..." };
    const session = Object.freeze({
      npc,
      player,
      nodeId: node.id,
      text: node.text,
      choices: (node.choices ?? []).filter(choice => evaluateCondition(choice.when, context)).map(choice => ({ id: choice.id, text: choice.text })),
      offer: node.offer ?? null,
      shop: node.shop ?? null,
      service: node.service ?? null,
      unlock: node.unlock ?? null,
    });
    if (node.offer) this.services?.quests?.offer?.(node.offer, { npc, player });
    if (node.unlock) this.services?.progression?.unlock?.(node.unlock, { npc, player });
    emitEvent(this.events, "dialogue:begin", session);
    return session;
  }

  choose(session, choiceId) {
    emitEvent(this.events, "dialogue:choice", { session, choiceId });
    return this.services?.dialogueActions?.run?.(choiceId, session) ?? null;
  }

  end(session) { emitEvent(this.events, "dialogue:end", { session }); }
}

export function createDialogueService(options) {
  return new DialogueService(options);
}
