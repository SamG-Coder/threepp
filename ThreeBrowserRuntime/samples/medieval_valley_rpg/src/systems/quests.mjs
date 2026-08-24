const OBJECTIVE_TYPES = new Set([
  "talk", "interact", "collect", "craft", "kill", "defend", "reach", "ignite", "return", "custom",
]);

/**
 * Generic, event-driven quest engine. Definitions contain only serializable
 * data; renderer/UI code can subscribe to emitted state changes.
 */
export class QuestSystem {
  constructor({ inventory = null, progression = null, reputation = null, economy = null, fireSystem = null } = {}) {
    this.inventory = inventory;
    this.progression = progression;
    this.reputation = reputation;
    this.economy = economy;
    this.fireSystem = fireSystem;
    this._definitions = new Map();
    this._states = new Map();
    this._listeners = new Set();
    this._clock = 0;
  }

  register(definition) {
    validateDefinition(definition);
    if (this._definitions.has(definition.id)) throw new RangeError(`quest already registered: ${definition.id}`);
    const copy = deepFreeze(structuredClone(definition));
    this._definitions.set(copy.id, copy);
    this._states.set(copy.id, initialState(copy, this.available(copy.id) ? "available" : "locked"));
    this._refreshAvailability();
    return copy;
  }

  registerMany(definitions) {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  definition(id) {
    const definition = this._definitions.get(id);
    if (!definition) throw new RangeError(`unknown quest: ${id}`);
    return definition;
  }

  available(id) {
    const definition = this._definitions.get(id);
    if (!definition) return false;
    return (definition.dependencies ?? []).every(dependency => this._states.get(dependency)?.status === "completed");
  }

  /** Safe status lookup for dialogue conditions; unknown quest IDs return null. */
  status(id) {
    return this._states.get(id)?.status ?? null;
  }

  start(id) {
    const definition = this.definition(id);
    const previous = this._states.get(id);
    if (previous.status === "active") return this.get(id);
    if (previous.status === "completed") throw new RangeError(`${id} is already completed`);
    if (!this.available(id)) throw new RangeError(`quest dependencies are not complete: ${id}`);
    const state = initialState(definition, "active");
    state.startedAt = this._clock;
    this._states.set(id, state);
    this._enterStage(definition, state);
    this._emit({ type: "quest:started", questId: id, quest: this.get(id) });
    this._settleAutomaticStages(definition, state);
    return this.get(id);
  }

  restart(id) {
    const state = this._states.get(id);
    if (!state || state.status !== "failed") throw new RangeError(`${id} is not failed`);
    this._states.set(id, initialState(this.definition(id), this.available(id) ? "available" : "locked"));
    return this.start(id);
  }

  notify(event) {
    if (!event || typeof event.type !== "string") throw new TypeError("quest events require a type");
    const updates = [];
    for (const [questId, state] of this._states) {
      if (state.status !== "active") continue;
      const definition = this.definition(questId);
      const failureReason = this._failureReason(definition, state, event);
      if (failureReason) {
        this._fail(definition, state, failureReason);
        updates.push(this.get(questId));
        continue;
      }
      const stage = definition.stages[state.stageIndex];
      let changed = false;
      for (const objective of stage.objectives) {
        const progress = state.objectives[objective.id];
        if (progress.complete || !matchesObjective(objective, event)) continue;
        const previous = progress.current;
        if (objective.type === "collect" && this.inventory) {
          progress.current = this.inventory.count(objective.target);
        } else {
          const amount = event.setTo == null ? positiveAmount(event.amount) : Number(event.setTo);
          progress.current = event.setTo == null ? progress.current + amount : Math.max(0, amount);
        }
        progress.current = Math.min(progress.required, progress.current);
        progress.complete = progress.current >= progress.required;
        changed ||= progress.current !== previous;
        this._emit({
          type: "quest:objective", questId, stageId: stage.id, objectiveId: objective.id,
          progress: { ...progress }, event: { ...event },
        });
      }
      if (changed) {
        this._completeReadyStage(definition, state);
        this._settleAutomaticStages(definition, state);
        updates.push(this.get(questId));
      }
    }
    return updates;
  }

  tick(gameMinutes) {
    if (!Number.isFinite(gameMinutes) || gameMinutes < 0) throw new RangeError("gameMinutes must be non-negative");
    this._clock += gameMinutes;
    const updates = [];
    for (const [questId, state] of this._states) {
      if (state.status !== "active") continue;
      state.stageElapsed += gameMinutes;
      const definition = this.definition(questId);
      const reason = this._failureReason(definition, state, { type: "tick", amount: gameMinutes });
      if (reason) {
        this._fail(definition, state, reason);
        updates.push(this.get(questId));
      }
    }
    return updates;
  }

  get(id) {
    const definition = this.definition(id);
    const state = this._states.get(id);
    const stage = state.stageIndex >= 0 ? definition.stages[state.stageIndex] : null;
    return {
      id,
      name: definition.name,
      description: definition.description ?? "",
      status: state.status,
      stageIndex: state.stageIndex,
      stageId: stage?.id ?? null,
      stageName: stage?.name ?? null,
      stageElapsed: state.stageElapsed,
      objectives: Object.values(state.objectives).map(objective => ({ ...objective })),
      dialogue: [...state.dialogue],
      failureReason: state.failureReason,
      rewardReceipt: structuredClone(state.rewardReceipt),
      dependencies: [...(definition.dependencies ?? [])],
    };
  }

  list({ status = null } = {}) {
    return [...this._definitions.keys()].map(id => this.get(id)).filter(quest => status == null || quest.status === status);
  }

  conditionMet(condition) {
    if (!condition || typeof condition !== "object") return Boolean(condition);
    switch (condition.type) {
      case "questStatus": return this._states.get(condition.questId)?.status === condition.status;
      case "questStage": return this.get(condition.questId).stageId === condition.stageId;
      case "objective": return Boolean(this._states.get(condition.questId)?.objectives?.[condition.objectiveId]?.complete) === (condition.complete ?? true);
      case "world": return compare(this.progression?.get(condition.key), condition.op ?? "equals", condition.value);
      case "reputation": return compare(this.reputation?.get(condition.faction) ?? 0, condition.op ?? "atLeast", condition.value);
      case "item": return compare(this.inventory?.count(condition.itemId) ?? 0, condition.op ?? "atLeast", condition.quantity ?? 1);
      case "dialogue": return this._states.get(condition.questId)?.dialogue.includes(condition.tag) ?? false;
      default: throw new RangeError(`unknown quest condition: ${condition.type}`);
    }
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return {
      clock: this._clock,
      states: Object.fromEntries([...this._states].map(([id, state]) => [id, structuredClone(state)])),
    };
  }

  restore(snapshot) {
    if (!snapshot?.states) throw new TypeError("invalid quest snapshot");
    this._clock = Number(snapshot.clock ?? 0);
    for (const [id, state] of Object.entries(snapshot.states)) {
      if (this._definitions.has(id)) this._states.set(id, structuredClone(state));
    }
    this._refreshAvailability();
    return this;
  }

  _enterStage(definition, state) {
    const stage = definition.stages[state.stageIndex];
    state.stageElapsed = 0;
    state.objectives = Object.fromEntries(stage.objectives.map(objective => [objective.id, {
      id: objective.id,
      type: objective.type,
      target: objective.target ?? null,
      description: objective.description ?? "",
      optional: Boolean(objective.optional),
      current: 0,
      required: objective.amount ?? 1,
      complete: false,
    }]));
    for (const tag of stage.dialogue ?? []) if (!state.dialogue.includes(tag)) state.dialogue.push(tag);
    this._applyEffects(stage.onEnterEffects, `${definition.id}:${stage.id}:enter`);
    this._syncCollectedObjectives(stage, state);
    this._emit({ type: "quest:stage", questId: definition.id, stageId: stage.id, quest: this.get(definition.id) });
  }

  _syncCollectedObjectives(stage, state) {
    if (!this.inventory) return;
    for (const objective of stage.objectives) {
      if (objective.type !== "collect") continue;
      const progress = state.objectives[objective.id];
      progress.current = Math.min(progress.required, this.inventory.count(objective.target));
      progress.complete = progress.current >= progress.required;
    }
  }

  _settleAutomaticStages(definition, state) {
    // Existing inventory may satisfy a newly entered collection stage. Bound
    // the loop to the definition length to defend against malformed zero-goal stages.
    for (let count = 0; count < definition.stages.length && state.status === "active"; count += 1) {
      const before = state.stageIndex;
      if (!this._completeReadyStage(definition, state) || state.stageIndex === before) break;
    }
  }

  _completeReadyStage(definition, state) {
    if (state.status !== "active") return false;
    const stage = definition.stages[state.stageIndex];
    const required = Object.values(state.objectives).filter(objective => !objective.optional);
    if (!required.every(objective => objective.complete)) return false;
    this._applyEffects(stage.onCompleteEffects, `${definition.id}:${stage.id}:complete`);
    this._emit({ type: "quest:stage-completed", questId: definition.id, stageId: stage.id });
    if (state.stageIndex >= definition.stages.length - 1) {
      state.status = "completed";
      state.completedAt = this._clock;
      state.rewardReceipt = this._grantRewards(definition.rewards ?? {}, definition.id);
      this._applyEffects(definition.onCompleteEffects, `${definition.id}:complete`);
      this._emit({ type: "quest:completed", questId: definition.id, quest: this.get(definition.id) });
      this._refreshAvailability();
      return true;
    }
    state.stageIndex += 1;
    this._enterStage(definition, state);
    return true;
  }

  _failureReason(definition, state, event) {
    const stage = definition.stages[state.stageIndex];
    for (const failure of [...(definition.failureConditions ?? []), ...(stage.failureConditions ?? [])]) {
      if (failure.type === "event" && event.type === failure.eventType &&
          (failure.target == null || failure.target === event.target)) return failure.reason ?? failure.id ?? "quest_failed";
      if (failure.type === "elapsed" && state.stageElapsed >= failure.minutes) return failure.reason ?? failure.id ?? "time_expired";
      if (failure.type === "worldAtMost" && Number(this.progression?.get(failure.key)) <= failure.value) {
        return failure.reason ?? failure.id ?? `${failure.key}_failed`;
      }
      if (failure.type === "worldEquals" && this.progression?.get(failure.key) === failure.value) {
        return failure.reason ?? failure.id ?? `${failure.key}_failed`;
      }
    }
    return null;
  }

  _fail(definition, state, reason) {
    if (state.status !== "active") return;
    const stage = definition.stages[state.stageIndex];
    state.status = "failed";
    state.failureReason = reason;
    this._applyEffects(stage.onFailEffects, `${definition.id}:${stage.id}:failed`);
    this._applyEffects(definition.onFailEffects, `${definition.id}:failed`);
    this._emit({ type: "quest:failed", questId: definition.id, reason, quest: this.get(definition.id) });
  }

  _applyEffects(effects = [], reason) {
    for (const effect of effects ?? []) {
      const service = effect.service ?? "world";
      if (service === "world") {
        if (!this.progression) continue;
        this.progression.applyEffects([effect], reason);
      } else if (service === "fire") {
        if (!this.fireSystem) continue;
        if (effect.op === "ignite") this.fireSystem.ignite(effect.id, { fuel: effect.fuel ?? 0, reason });
        else if (effect.op === "extinguish") this.fireSystem.extinguish(effect.id, reason);
        else if (effect.op === "refuel") this.fireSystem.refuel(effect.id, effect.value);
        else throw new RangeError(`unsupported fire effect: ${effect.op}`);
      } else if (service === "reputation") {
        if (!this.reputation) continue;
        if ((effect.op ?? "add") === "add") this.reputation.add(effect.faction, effect.value, reason);
        else if (effect.op === "set") this.reputation.set(effect.faction, effect.value, reason);
        else throw new RangeError(`unsupported reputation effect: ${effect.op}`);
      } else if (service === "inventory") {
        if (!this.inventory) continue;
        if (effect.op === "add") this.inventory.addExact(effect.itemId, effect.quantity ?? 1, reason);
        else if (effect.op === "remove") this.inventory.remove(effect.itemId, effect.quantity ?? 1, reason);
        else throw new RangeError(`unsupported inventory effect: ${effect.op}`);
      } else if (service === "economy") {
        if (!this.economy) continue;
        if (effect.op === "addGold") this.economy.addGold(effect.value, reason);
        else throw new RangeError(`unsupported economy effect: ${effect.op}`);
      } else {
        throw new RangeError(`unknown quest effect service: ${service}`);
      }
    }
  }

  _grantRewards(rewards, questId) {
    const receipt = { currency: 0, reputation: {}, items: {}, pendingItems: {} };
    if (Number.isFinite(rewards.currency) && rewards.currency > 0) {
      if (this.economy) this.economy.addGold(rewards.currency, `quest:${questId}`);
      receipt.currency = rewards.currency;
    }
    for (const [faction, amount] of Object.entries(rewards.reputation ?? {})) {
      if (this.reputation) this.reputation.add(faction, amount, `quest:${questId}`);
      receipt.reputation[faction] = amount;
    }
    for (const [itemId, quantity] of Object.entries(rewards.items ?? {})) {
      if (!this.inventory) {
        receipt.pendingItems[itemId] = quantity;
        continue;
      }
      const result = this.inventory.add(itemId, quantity, `quest:${questId}`);
      if (result.added) receipt.items[itemId] = result.added;
      if (result.rejected) receipt.pendingItems[itemId] = result.rejected;
    }
    return receipt;
  }

  _refreshAvailability() {
    for (const [id, state] of this._states) {
      if (state.status !== "locked" && state.status !== "available") continue;
      state.status = this.available(id) ? "available" : "locked";
    }
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event);
  }
}

function validateDefinition(definition) {
  if (!definition?.id || !definition.name || !Array.isArray(definition.stages) || definition.stages.length === 0) {
    throw new TypeError("quest definitions require id, name and at least one stage");
  }
  const stageIds = new Set();
  for (const stage of definition.stages) {
    if (!stage.id || stageIds.has(stage.id) || !Array.isArray(stage.objectives) || stage.objectives.length === 0) {
      throw new TypeError(`invalid stage in ${definition.id}`);
    }
    stageIds.add(stage.id);
    const objectiveIds = new Set();
    for (const objective of stage.objectives) {
      if (!objective.id || objectiveIds.has(objective.id) || !OBJECTIVE_TYPES.has(objective.type)) {
        throw new TypeError(`invalid objective in ${definition.id}/${stage.id}`);
      }
      if ((objective.amount ?? 1) <= 0) throw new RangeError("objective amount must be positive");
      objectiveIds.add(objective.id);
    }
  }
}

function initialState(definition, status) {
  return {
    status,
    stageIndex: status === "active" ? 0 : -1,
    stageElapsed: 0,
    objectives: {},
    dialogue: [...(definition.dialogue ?? [])],
    failureReason: null,
    rewardReceipt: null,
    startedAt: null,
    completedAt: null,
  };
}

function matchesObjective(objective, event) {
  if (objective.type !== event.type) return false;
  if (objective.target != null && objective.target !== event.target) return false;
  return true;
}

function positiveAmount(amount) {
  const value = amount == null ? 1 : Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("quest event amount must be positive");
  return value;
}

function compare(actual, operation, expected) {
  switch (operation) {
    case "equals": return actual === expected;
    case "notEquals": return actual !== expected;
    case "atLeast": return Number(actual) >= Number(expected);
    case "atMost": return Number(actual) <= Number(expected);
    case "greaterThan": return Number(actual) > Number(expected);
    case "lessThan": return Number(actual) < Number(expected);
    default: throw new RangeError(`unknown comparison: ${operation}`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
