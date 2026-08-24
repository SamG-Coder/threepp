import * as THREE from "three/webgpu";
import {
  CraftingSystem,
  EconomySystem,
  Inventory,
  QuestSystem,
  ReputationSystem,
  TimeSystem,
  WeatherSystem,
  createDefaultFireSystem,
  createDefaultQuestDefinitions,
  createWorldProgression,
  getItem,
} from "../systems/index.mjs";
import { createSaveService } from "./save.mjs";

const MAIN_QUEST_ID = "light_against_the_dark";
const TRADE_QUEST_ID = "roads_of_trade";

const VISIBLE_WEAPONS = Object.freeze({
  village_sword: "sword",
  warden_blade: "sword",
  iron_greatsword: "twoHanded",
  hunting_crossbow: "crossbow",
});

function nowSeconds() {
  return Number(globalThis.performance?.now?.() ?? Date.now()) * 0.001;
}

function wrapText(value, width = 56, lines = 4) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const output = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width && line) {
      output.push(line);
      line = word;
      if (output.length >= lines) break;
    } else line = `${line} ${word}`.trim();
  }
  if (line && output.length < lines) output.push(line);
  return output.join("\n");
}

function progressVisual(main, progression) {
  const stages = ["arrival", "village", "forest", "forest", "beacon_repaired", "beacon_repaired", "fortress", "fortress", "complete"];
  return {
    stage: main.status === "completed" ? "complete" : stages[Math.max(0, main.stageIndex)] ?? "arrival",
    amount: main.status === "completed" ? 1 : Math.max(0, main.stageIndex) / 8,
    fortressUnlocked: Boolean(progression.get("fortressRouteUnlocked")),
    beaconRepaired: Number(progression.get("beaconRepairProgress")) >= 1,
    beaconLit: Boolean(progression.get("beaconLit")),
    villageSafe: Number(progression.get("villageSafety")) >= 0.45,
    corruption: Number(progression.get("corruptionStrength") ?? 1),
  };
}

function fireType(definition) {
  const key = `${definition.kind ?? ""} ${definition.id}`.toLowerCase();
  if (key.includes("beacon")) return "beacon";
  if (key.includes("forge") || key.includes("fireplace") || key.includes("hearth")) return "fireplace";
  if (key.includes("camp")) return "campfire";
  if (key.includes("brazier")) return "brazier";
  return "torch";
}

function playerPosition(player) {
  return player?.root?.position ?? null;
}

/**
 * Owns the interconnected, serializable game state. Rendering and actor AI are
 * supplied later so this module stays useful in deterministic tests.
 */
export function createGameSession({ events, input }) {
  const inventory = new Inventory({
    maxSlots: 36,
    weightCapacity: 72,
    baseStats: { health: 120, stamina: 110, attack: 5, defense: 0, poise: 60, stability: 0, moveSpeed: 1, blockReduction: 0 },
  });
  const progression = createWorldProgression();
  const reputation = new ReputationSystem();
  const fire = createDefaultFireSystem({ progression });
  const weather = new WeatherSystem({ mode: "cloudy", seed: "keepfall-weather-2187", autoCycle: true });
  const time = new TimeSystem({ day: 0, hour: 17.35, timeScale: 10 });
  const economy = new EconomySystem({ inventory, progression, reputation, startingGold: 90 });
  const crafting = new CraftingSystem({ inventory, progression, reputation });
  const quests = new QuestSystem({ inventory, progression, reputation, economy, fireSystem: fire });
  quests.registerMany(createDefaultQuestDefinitions());
  quests.start(MAIN_QUEST_ID);
  quests.start(TRADE_QUEST_ID);
  const saves = createSaveService();

  inventory.addExact("village_sword", 1, "starting-loadout");
  inventory.addExact("iron_shield", 1, "starting-loadout");
  inventory.addExact("leather_jerkin", 1, "starting-loadout");
  inventory.addExact("trail_boots", 1, "starting-loadout");
  inventory.addExact("healing_draught", 2, "starting-loadout");
  inventory.equip("village_sword");
  inventory.equip("iron_shield");
  inventory.equip("leather_jerkin");
  inventory.equip("trail_boots");

  const ui = {
    prompt: "",
    toast: "Arrive at Greywater Village and find Elder Mara",
    toastUntil: 6,
    dialogue: null,
    panel: null,
  };
  const resourceNodes = new Map();
  const disposers = [];
  let world = null;
  let player = null;
  let npcs = null;
  let enemies = null;
  let elapsed = 0;
  let rtxStatus = { label: "WEBGPU FALLBACK", features: {} };
  let objectiveTarget = null;

  function toast(message, duration = 4.2) {
    ui.toast = String(message ?? "");
    ui.toastUntil = elapsed + duration;
  }

  function activeQuest() {
    return quests.get(MAIN_QUEST_ID);
  }

  function activeObjective() {
    const main = activeQuest();
    return main.objectives.find(objective => !objective.complete && !objective.optional)
      ?? main.objectives.find(objective => !objective.complete)
      ?? null;
  }

  function updateWorldProgress() {
    if (!world) return;
    world.setProgress(progressVisual(activeQuest(), progression));
  }

  function equipmentProfile(profile) {
    return {
      windup: profile.windup,
      active: profile.active,
      recovery: profile.recovery,
      stamina: profile.staminaCost,
      damage: profile.damage,
      poise: profile.poiseDamage,
      reach: profile.range,
      projectile: profile.projectile,
      speed: profile.speed,
    };
  }

  function syncPlayerEquipment() {
    if (!player) return;
    const beforeHealthRatio = player.stats.health / Math.max(1, player.stats.maxHealth);
    const beforeStaminaRatio = player.stats.stamina / Math.max(1, player.stats.maxStamina);
    const stats = inventory.derivedStats();
    player.stats.maxHealth = Math.max(1, stats.health);
    player.stats.health = Math.max(1, Math.min(player.stats.maxHealth, player.stats.maxHealth * beforeHealthRatio));
    player.stats.maxStamina = Math.max(1, stats.stamina);
    player.stats.stamina = Math.min(player.stats.maxStamina, player.stats.maxStamina * beforeStaminaRatio);
    player.stats.armor = Math.max(0, stats.defense);
    player.stats.poise = Math.max(1, stats.poise);
    player.stats.currentPoise = Math.min(player.stats.currentPoise ?? player.stats.poise, player.stats.poise);
    player.baseWalkSpeed ??= player.controller.config.walkSpeed;
    player.baseSprintSpeed ??= player.controller.config.sprintSpeed;
    player.controller.config.walkSpeed = player.baseWalkSpeed * stats.moveSpeedMultiplier;
    player.controller.config.sprintSpeed = player.baseSprintSpeed * stats.moveSpeedMultiplier;
    player.userMoveMultiplier = stats.moveSpeedMultiplier;
    player.combatProfile = {
      light: equipmentProfile(inventory.attackProfile({ heavy: false })),
      heavy: equipmentProfile(inventory.attackProfile({ heavy: true })),
    };
    const main = inventory.equipped("mainHand")?.itemId ?? "village_sword";
    const off = inventory.equipped("offHand")?.itemId === "iron_shield" ? "shield" : null;
    const body = inventory.equipped("body")?.itemId;
    const owned = inventory.stacks
      .map(stack => VISIBLE_WEAPONS[stack.itemId] ?? (stack.itemId === "iron_shield" ? "shield" : null))
      .filter(Boolean);
    player.setLoadout({
      mainHand: VISIBLE_WEAPONS[main] ?? "sword",
      offHand: off,
      armor: body === "mail_hauberk" || body === "warden_plate" ? "plate" : "leather",
      owned: [...new Set(owned)],
    });
  }

  function attachWorld(value) {
    world = value;
    for (const definition of world?.fireDefinitions ?? []) {
      if (fire.has(definition.id)) continue;
      fire.register({
        id: definition.id,
        type: definition.type ?? fireType(definition),
        lit: definition.lit,
        exposed: !definition.protectedFromRain,
        rainResistance: definition.protectedFromRain ? 0.95 : 0,
      });
    }
    updateResourceNodes();
    updateWorldProgress();
    world?.applyWeather?.(weather.current());
  }

  function attachActors({ player: nextPlayer, npcs: nextNpcs, enemies: nextEnemies }) {
    player = nextPlayer;
    npcs = nextNpcs;
    enemies = nextEnemies;
    syncPlayerEquipment();
  }

  function nearestTarget() {
    const position = playerPosition(player);
    if (!position) return null;
    const npc = npcs?.nearest?.(position, 2.65) ?? null;
    const interactable = world?.interactions?.nearest?.(position, 3.6) ?? null;
    if (!npc) return interactable ? { type: "world", value: interactable } : null;
    if (!interactable) return { type: "npc", value: npc };
    const npcDistance = npc.root.position.distanceToSquared(position);
    const interactionDistance = new THREE.Vector3().fromArray(interactable.position).distanceToSquared(position);
    return npcDistance <= interactionDistance ? { type: "npc", value: npc } : { type: "world", value: interactable };
  }

  function ensureBeaconFittings() {
    const recipe = crafting.recipe("beacon_iron_fittings");
    try {
      for (const [itemId, quantity] of Object.entries(recipe.inputs)) {
        const missing = Math.max(0, quantity - inventory.availableCount(itemId));
        if (missing) economy.buy("blacksmith", itemId, missing);
      }
      crafting.craft("beacon_iron_fittings", { station: "forge" });
      toast("Brynna forges new iron fittings for the beacon");
      return true;
    } catch (error) {
      toast(`Fittings need iron, charcoal, and coin: ${error?.message || error}`, 5.5);
      return false;
    }
  }

  function prepareBeaconResin() {
    try {
      crafting.craft("beacon_resin_bundle", { station: "workbench" });
      toast("Resin, cloth, and kindling bound for the beacon");
      return true;
    } catch (error) {
      toast("Gather 3 pine resin, 2 seasoned wood, and 1 cloth first", 5);
      return false;
    }
  }

  function interactNpc(npc) {
    const session = npcs?.interact?.(npc, player, {
      quests,
      worldState: progression,
      inventory,
      reputation: reputation.get("village"),
      weather: weather.current(),
      hour: time.timeOfDay,
    });
    if (npc.id === "brynna-vale" && activeQuest().stageId === "obtain_iron_fittings" &&
        inventory.count("beacon_iron_fittings") === 0) ensureBeaconFittings();
    if (npc.id === "merchant_elin" && progression.get("merchantRouteOpen")) {
      toast("The safer road has restored Elin's travelling stock");
    }
    return session;
  }

  function resourceState(interactable) {
    let state = resourceNodes.get(interactable.id);
    if (!state) {
      state = { uses: 0, respawnAt: 0 };
      resourceNodes.set(interactable.id, state);
    }
    return state;
  }

  function updateResourceNodes() {
    if (!world) return;
    for (const interactable of world.interactables ?? []) {
      const metadata = interactable.metadata ?? {};
      if (!metadata.itemId && !metadata.item) continue;
      const state = resourceNodes.get(interactable.id);
      if (!state) continue;
      const maxUses = Math.max(1, Math.trunc(Number(metadata.maxUses) || 1));
      if (state.uses < maxUses) {
        interactable.enabled = true;
        continue;
      }
      const respawnSeconds = Math.max(0, Number(metadata.respawnSeconds) || 0);
      if (respawnSeconds > 0 && state.respawnAt > 0 && elapsed >= state.respawnAt) {
        state.uses = 0;
        state.respawnAt = 0;
        interactable.enabled = true;
      } else interactable.enabled = false;
    }
  }

  function gather(interactable) {
    const metadata = interactable.metadata ?? {};
    const itemId = metadata.itemId ?? metadata.item ?? (interactable.id === "resin_grove" ? "pine_resin" : null);
    if (!itemId) return false;
    const maxUses = Math.max(1, Math.trunc(Number(metadata.maxUses) || 1));
    const state = resourceState(interactable);
    if (state.uses >= maxUses) {
      const remaining = Math.max(0, state.respawnAt - elapsed);
      toast(remaining > 0
        ? `This resource patch recovers in ${Math.ceil(remaining)} seconds`
        : "This resource patch has been exhausted");
      return true;
    }
    const quantity = Math.max(1, Math.trunc(Number(metadata.quantity ?? metadata.amount) ||
      (itemId === "pine_resin" ? 3 : itemId === "seasoned_wood" ? 2 : 1)));
    const result = inventory.add(itemId, quantity, `gather:${interactable.id}`);
    if (!result.added) {
      toast("Your inventory cannot carry more");
      return true;
    }
    state.uses += 1;
    const remainingUses = Math.max(0, maxUses - state.uses);
    if (remainingUses === 0) {
      const respawnSeconds = Math.max(0, Number(metadata.respawnSeconds) || 0);
      state.respawnAt = respawnSeconds > 0 ? elapsed + respawnSeconds : 0;
      interactable.enabled = false;
    }
    toast(`Gathered ${getItem(itemId).name} x${result.added}${remainingUses ? ` · ${remainingUses} gathers remain` : ""}`);
    return true;
  }

  function interactWorld(interactable) {
    const stage = activeQuest().stageId;
    if (gather(interactable)) return interactable;
    switch (interactable.id) {
      case "village_beacon":
        if (stage === "inspect_beacon") {
          quests.notify({ type: "interact", target: "village_beacon" });
          toast("The beacon needs resin, iron fittings, and defenders");
        } else if (stage === "light_beacon" && Number(progression.get("beaconRepairProgress")) >= 1) {
          quests.notify({ type: "ignite", target: "village_beacon" });
          toast("The valley beacon burns again", 7);
        } else if (progression.get("beaconLit")) toast("The beacon throws warm light across the valley");
        else toast("The damaged beacon cannot yet hold a flame");
        break;
      case "hunter_camp_bedroll":
        if (stage === "obtain_resin") prepareBeaconResin();
        else {
          player.heal(player.stats.maxHealth);
          time.advance(60);
          toast("You rest beside the hunter's fire. One hour passes");
        }
        break;
      case "blacksmith":
        if (stage === "obtain_iron_fittings") ensureBeaconFittings();
        else ui.panel = { kind: "crafting", title: "BLACKSMITH FORGE" };
        break;
      case "market_stalls":
        ui.panel = { kind: "economy", title: "GREYWATER MARKET" };
        break;
      case "fortress_gate":
        if (progression.get("fortressRouteUnlocked")) {
          quests.notify({ type: "reach", target: "fortress_gate" });
          toast("The beacon reveals the open way into Keepfall");
        } else toast("The portcullis is sealed. Restore the village beacon first");
        break;
      case "wolf_den_heart":
        quests.notify({ type: "interact", target: "wolf_den_heart" });
        progression.set("wolfDenCleared", true, "destroyed-den-heart");
        toast("The corruption heart collapses; the trade road grows safer", 6);
        interactable.enabled = false;
        break;
      case "west_field_crop":
      case "east_field_crop":
        inventory.add("cloth", 1, "field-help");
        inventory.add("medicinal_herbs", 2, "field-help");
        toast("The farmers share cloth and useful herbs");
        break;
      default:
        if (interactable.kind === "rest") {
          player.heal(player.stats.maxHealth);
          time.advance(60);
          toast("Rested and recovered");
        } else toast(interactable.prompt ?? `Used ${interactable.id}`);
        quests.notify({ type: "interact", target: interactable.id });
        break;
    }
    return interactable;
  }

  function interact() {
    if (ui.dialogue) {
      events.emit("dialogue:end", ui.dialogue);
      return null;
    }
    if (ui.panel) {
      ui.panel = null;
      return null;
    }
    const target = nearestTarget();
    if (!target) {
      toast("Nothing nearby can be used", 2.2);
      return null;
    }
    return target.type === "npc" ? interactNpc(target.value) : interactWorld(target.value);
  }

  function useQuickItem() {
    if (inventory.count("healing_draught") <= 0) {
      toast("No Redleaf Draughts remain");
      return;
    }
    const effect = inventory.consume("healing_draught");
    player?.heal?.(effect.health ?? 0);
    toast("Used Redleaf Draught");
  }

  function cycleEquippedWeapon() {
    const owned = ["village_sword", "iron_greatsword", "hunting_crossbow", "warden_blade"]
      .filter(itemId => inventory.count(itemId) > 0);
    if (owned.length < 2) {
      toast("Find or craft another weapon first");
      return;
    }
    const current = inventory.equipped("mainHand")?.itemId;
    inventory.equip(owned[(owned.indexOf(current) + 1) % owned.length]);
    toast(`Equipped ${getItem(inventory.equipped("mainHand").itemId).name}`);
  }

  function togglePanel(kind, title) {
    ui.dialogue = null;
    ui.panel = ui.panel?.kind === kind ? null : { kind, title };
  }

  async function quickSave() {
    try {
      const file = await saves.save("quicksave", persistentSnapshot());
      toast(`Quicksaved to ${file}`, 3.5);
    } catch (error) { toast(`Save failed: ${error?.message || error}`, 5); }
  }

  async function quickLoad() {
    try {
      const snapshot = await saves.load("quicksave");
      if (!snapshot) return toast("No quicksave exists");
      restore(snapshot);
      toast("Quicksave restored");
    } catch (error) { toast(`Load failed: ${error?.message || error}`, 5); }
  }

  function handleInput() {
    if (input.consumePressed("quickItem") && !ui.panel && !ui.dialogue) useQuickItem();
    if (input.consumePressed("inventory")) togglePanel("inventory", "INVENTORY");
    if (input.consumePressed("equipment")) togglePanel("equipment", "EQUIPMENT");
    if (input.consumePressed("crafting")) togglePanel("crafting", "CRAFTING");
    if (input.consumePressed("questLog")) togglePanel("quests", "QUEST LOG");
    if (input.consumePressed("settings")) togglePanel("settings", "SETTINGS AND RUNTIME");
    if (input.consumePressed("cancel")) {
      if (ui.dialogue) events.emit("dialogue:end", ui.dialogue);
      ui.panel = null;
    }
    if (input.consumePressed("dialogueAdvance") && ui.dialogue) events.emit("dialogue:end", ui.dialogue);
    if (input.consumePressed("quickSave")) void quickSave();
    if (input.consumePressed("quickLoad")) void quickLoad();
    if (input.consumePressed("nextWeapon") && ui.panel?.kind === "equipment") cycleEquippedWeapon();
  }

  function resolveObjectiveTarget(objective) {
    if (!objective || !world) return null;
    const npc = npcs?.get?.(objective.target);
    if (npc?.root?.position) return npc.root.position;
    const interaction = world.interactables?.find(item => item.id === objective.target || item.landmarkId === objective.target);
    if (interaction?.position) return new THREE.Vector3().fromArray(interaction.position);
    const landmark = world.landmarks?.[objective.target];
    if (landmark?.position) return new THREE.Vector3().fromArray(landmark.position);
    if (objective.target === "fortress_warden") return new THREE.Vector3(0, world.terrainHeight(0, -200), -200);
    if (objective.target === "beacon_repair_site") return world.landmarks?.village_beacon?.object?.position ?? null;
    return null;
  }

  function compassText() {
    const position = playerPosition(player);
    if (!position || !objectiveTarget) return "OBJECTIVE --";
    const dx = objectiveTarget.x - position.x;
    const dz = objectiveTarget.z - position.z;
    const distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, -dz) * 180 / Math.PI;
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const direction = directions[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
    return `OBJECTIVE ${direction}  ${Math.round(distance)}M`;
  }

  function panelSummary() {
    if (!ui.panel) return "";
    if (ui.panel.kind === "inventory") {
      const rows = inventory.stacks.slice(0, 14).map(stack => `${getItem(stack.itemId).name}  X${stack.quantity}`);
      return [`GOLD ${economy.gold}   WEIGHT ${inventory.totalWeight}/${inventory.weightCapacity}`, ...rows].join("\n");
    }
    if (ui.panel.kind === "equipment") {
      const stats = inventory.derivedStats();
      const rows = Object.entries(inventory.equipment).map(([slot, item]) => `${slot}: ${getItem(item.itemId).name}`);
      return [`ATTACK ${stats.attack}  DEFENCE ${stats.defense}  POISE ${stats.poise}`, ...rows, "PRESS X TO CYCLE OWNED WEAPONS"].join("\n");
    }
    if (ui.panel.kind === "crafting") {
      return Object.values(crafting.recipes).map(recipe => {
        const check = crafting.canCraft(recipe.id, { station: recipe.station });
        return `${check.ok ? "READY" : "NEEDS MATERIALS"}  ${recipe.name}`;
      }).join("\n");
    }
    if (ui.panel.kind === "economy") {
      const merchant = economy.merchant("blacksmith");
      return [`GOLD ${economy.gold}`, ...Object.entries(merchant.stock).filter(([, count]) => count > 0)
        .map(([itemId, count]) => `${getItem(itemId).name} X${count}  ${economy.quote("blacksmith", itemId)}G`)].join("\n");
    }
    if (ui.panel.kind === "quests") {
      return quests.list().map(quest => `${quest.status}: ${quest.name}\n  ${quest.stageName ?? "COMPLETE"}`).join("\n");
    }
    return [
      "WASD MOVE   SHIFT SPRINT   SPACE JUMP",
      "LMB LIGHT   SHIFT+LMB/Q HEAVY   RMB BLOCK",
      "ALT DODGE   E INTERACT   X CHANGE WEAPON",
      "I INVENTORY  U EQUIPMENT  C CRAFTING  J QUESTS",
      "K QUICKSAVE  L QUICKLOAD  O SETTINGS",
      `RENDER PATH: ${rtxStatus.label}`,
    ].join("\n");
  }

  function update(delta, nextElapsed, diagnostics = {}) {
    elapsed = Number.isFinite(nextElapsed) ? nextElapsed : elapsed + delta;
    updateResourceNodes();
    handleInput();
    const gameMinutes = Math.max(0, delta) / 60 * time.timeScale;
    const timeState = time.advanceRealSeconds(Math.max(0, delta));
    const weatherState = weather.advance(gameMinutes);
    fire.advance(gameMinutes, weatherState);
    economy.advance(gameMinutes);
    quests.tick(gameMinutes);
    updateWorldProgress();
    world?.applyWeather?.(weatherState);

    const objective = activeObjective();
    objectiveTarget = resolveObjectiveTarget(objective);
    const target = nearestTarget();
    ui.prompt = target?.type === "npc" ? `Talk to ${target.value.name}` : target?.value?.prompt ?? "";

    const position = playerPosition(player);
    if (position && activeQuest().stageId === "follow_signal" && position.z < -151) {
      quests.notify({ type: "reach", target: "fortress_gate" });
    }
    if (position && activeQuest().stageId === "follow_signal") {
      const tower = world?.landmarks?.old_watchtower?.position;
      if (tower && position.distanceToSquared(new THREE.Vector3().fromArray(tower)) < 10 * 10) {
        quests.notify({ type: "reach", target: "old_watchtower" });
      }
    }

    return snapshot(diagnostics);
  }

  function snapshot(diagnostics = {}) {
    const main = activeQuest();
    const objective = activeObjective();
    const weaponId = inventory.equipped("mainHand")?.itemId ?? "village_sword";
    const boss = enemies?.active?.("fortressWarden")?.find(enemy => enemy.alive !== false) ?? null;
    return {
      elapsed,
      player: {
        health: player?.stats?.health ?? 120,
        maxHealth: player?.stats?.maxHealth ?? 120,
        stamina: player?.stats?.stamina ?? 110,
        maxStamina: player?.stats?.maxStamina ?? 110,
        weaponName: getItem(weaponId).name,
        quickItemName: getItem("healing_draught").name,
        quickItemCount: inventory.count("healing_draught"),
      },
      objective: objective?.description ?? (main.status === "completed" ? "Greywater is safe" : main.stageName ?? "Explore Greywater"),
      compass: compassText(),
      prompt: ui.prompt,
      toast: ui.toast,
      toastUntil: ui.toastUntil,
      dialogue: ui.dialogue ? { speaker: ui.dialogue.npc?.name ?? "Villager", text: wrapText(ui.dialogue.text, 72, 3) } : null,
      panel: ui.panel ? { ...ui.panel, summary: panelSummary() } : null,
      boss: boss ? { name: boss.name, health: boss.stats.health, maxHealth: boss.stats.maxHealth, phase: boss.phase } : null,
      quest: main,
      inventory: inventory.snapshot(),
      progression: progression.snapshot(),
      reputation: reputation.snapshot(),
      economy: economy.snapshot(),
      time: timeStateOrCurrent(),
      weather: weather.current(),
      fire: fire.snapshot(),
      resources: [...resourceNodes.entries()].map(([id, state]) => ({
        id,
        uses: state.uses,
        respawnRemaining: Math.max(0, state.respawnAt - elapsed),
      })),
      diagnostics: { ...diagnostics, rtx: rtxStatus },
    };
  }

  function timeStateOrCurrent() {
    return time.snapshot();
  }

  function persistentSnapshot() {
    return {
      version: 1,
      inventory: inventory.snapshot(),
      progression: progression.snapshot(),
      reputation: reputation.snapshot(),
      economy: economy.snapshot(),
      quests: quests.snapshot(),
      time: time.snapshot(),
      weather: weather.snapshot(),
      fire: fire.snapshot(),
      resources: [...resourceNodes.entries()].map(([id, state]) => ({
        id,
        uses: state.uses,
        respawnRemaining: Math.max(0, state.respawnAt - elapsed),
      })),
      player: player ? {
        position: player.root.position.toArray(),
        yaw: player.root.rotation.y,
        health: player.stats.health,
        stamina: player.stats.stamina,
      } : null,
    };
  }

  function restore(value) {
    if (!value || value.version !== 1) throw new TypeError("Unsupported save snapshot");
    inventory.restore(value.inventory);
    progression.restore(value.progression);
    reputation.restore(value.reputation);
    economy.restore(value.economy);
    quests.restore(value.quests);
    time.restore(value.time);
    weather.restore(value.weather);
    fire.restore(value.fire);
    resourceNodes.clear();
    for (const resource of value.resources ?? []) {
      if (!resource?.id) continue;
      resourceNodes.set(resource.id, {
        uses: Math.max(0, Math.trunc(Number(resource.uses) || 0)),
        respawnAt: elapsed + Math.max(0, Number(resource.respawnRemaining) || 0),
      });
    }
    updateResourceNodes();
    if (player && value.player) {
      player.root.position.fromArray(value.player.position);
      player.root.rotation.y = value.player.yaw;
      player.stats.health = value.player.health;
      player.stats.stamina = value.player.stamina;
    }
    syncPlayerEquipment();
    updateWorldProgress();
  }

  inventory.subscribe(event => {
    if (event.type === "inventory:add") quests.notify({ type: "collect", target: event.itemId, amount: event.quantity });
    if (["inventory:equip", "inventory:unequip", "inventory:durability", "inventory:upgrade", "inventory:restore"].includes(event.type)) {
      syncPlayerEquipment();
    }
  });
  crafting.subscribe(event => {
    if (event.type === "craft") quests.notify({ type: "craft", target: event.recipeId, amount: event.times });
    toast(event.type === "craft" ? "Crafting complete" : `${event.type} complete`);
  });
  quests.subscribe(event => {
    if (event.type === "quest:stage") toast(`Quest updated: ${event.quest.stageName}`, 5);
    else if (event.type === "quest:completed") toast(`Quest complete: ${event.quest.name}`, 7);
    else if (event.type === "quest:failed") toast(`Quest failed: ${event.reason}`, 7);
    updateWorldProgress();
  });
  progression.subscribe(event => {
    if (event.key === "beaconLit" && event.value) toast("Beacon light has reduced attacks near the village", 7);
    if (event.key === "merchantRouteOpen" && event.value) toast("Merchant route reopened; village stock improved", 6);
    updateWorldProgress();
  });
  disposers.push(events.on("dialogue:begin", session => { ui.panel = null; ui.dialogue = session; }));
  disposers.push(events.on("dialogue:end", () => { ui.dialogue = null; }));
  disposers.push(events.on("loot:collected", detail => {
    if (detail.received?.length) toast(`Loot: ${detail.received.join(", ")}`);
  }));
  disposers.push(events.on("boss:phase", detail => toast(`Fortress Warden enters phase ${detail.phase}`, 4)));
  disposers.push(events.on("combat:death", detail => {
    if (detail.actor?.type === "player") toast("You have fallen. Press L to restore your quicksave", 12);
  }));

  return {
    services: { inventory, progression, worldState: progression, reputation, fire, weather, time, economy, crafting, quests },
    inventory,
    progression,
    reputation,
    fire,
    weather,
    time,
    economy,
    crafting,
    quests,
    ui,
    get paused() { return Boolean(ui.panel || ui.dialogue); },
    attachWorld,
    attachActors,
    interact,
    cycleWeapon: cycleEquippedWeapon,
    update,
    snapshot,
    persistentSnapshot,
    restore,
    toast,
    setRtxStatus(value) { rtxStatus = value ?? rtxStatus; },
    setWeather(mode, transitionMinutes = 4) { return weather.setWeather(mode, { transitionMinutes, reason: "control" }); },
    setTime(hour) { return time.set(time.snapshot().day, Number(hour)); },
    dispose() { for (const dispose of disposers.splice(0)) dispose?.(); },
  };
}
