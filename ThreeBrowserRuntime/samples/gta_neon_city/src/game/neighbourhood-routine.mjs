export const NEIGHBOURHOOD_ROUTINE_SAVE_VERSION = 1;

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_INTERACTION_RADIUS = 5.25;

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

function item(id, name, cost, heal, stamina, appetite, consumeSeconds, purchaseLine) {
  return Object.freeze({
    id,
    name,
    cost,
    heal,
    stamina,
    appetite,
    consumeSeconds,
    purchaseLine,
    payForward: false,
  });
}

function hours(open, close) {
  const overnight = close <= open;
  return Object.freeze({
    open,
    close,
    openMinute: open * 60,
    closeMinute: close * 60,
    overnight,
    label: `${String(open).padStart(2, "0")}:00-${String(close).padStart(2, "0")}:00`,
  });
}

function business(id, name, keeperName, position, openingHours, items, welcome) {
  return Object.freeze({
    id,
    name,
    keeperName,
    position: point(position),
    openingHours,
    items: Object.freeze(items),
    welcome,
  });
}

/**
 * Authored businesses deliberately cover both daytime and overnight schedules.
 * World code may replace only their positions through createNeighbourhoodRoutine
 * without duplicating the menus or dialogue.
 */
export const DEFAULT_NEIGHBOURHOOD_BUSINESSES = Object.freeze([
  business(
    "common_ground_cafe",
    "COMMON GROUND CAFE",
    "ASHA PATEL",
    [-40, 0.2, -16.5],
    hours(6, 18),
    [
      item("asha_breakfast_roll", "ASHA'S BREAKFAST ROLL", 18, 4, 18, 24, 2.4, "Hot plate, warm bread. Give yourself a minute before you run again."),
      item("ginger_oat_bowl", "GINGER OAT BOWL", 14, 2, 12, 20, 2.1, "Not glamorous. Reliable things rarely are."),
      item("cardamom_coffee", "CARDAMOM COFFEE", 9, 0, 25, 8, 1.45, "Slow sip. The city is already rushing enough for both of you."),
    ],
    "First cup is never the important part. Sitting down is.",
  ),
  business(
    "mina_market_kitchen",
    "MINA'S MARKET KITCHEN",
    "MINA OKAFOR",
    [-144, 0.2, 113],
    hours(7, 21),
    [
      item("market_jollof_box", "MARKET JOLLOF BOX", 24, 8, 14, 34, 2.8, "My mother measured rice with her hand. I measure it by who needs seconds."),
      item("plantain_wrap", "PLANTAIN AND BEAN WRAP", 17, 4, 15, 25, 2.25, "Eat it while the plantain still argues with the pepper."),
      item("hibiscus_tea", "CHILLED HIBISCUS TEA", 8, 1, 19, 7, 1.3, "Tart enough to wake you up, kind enough not to shout."),
    ],
    "A market remembers who shows up when the shutters are heavy.",
  ),
  business(
    "harbour_lantern",
    "HARBOUR LANTERN",
    "KENJI SATO",
    [148, 0.2, 148],
    hours(17, 3),
    [
      item("dockworker_ramen", "DOCKWORKER RAMEN", 26, 9, 16, 38, 3, "Broth takes twelve hours. You are allowed to take three minutes."),
      item("miso_rice_triangle", "MISO RICE TRIANGLE", 12, 3, 13, 19, 1.8, "Small food for a long night. That is not the same as a small kindness."),
      item("yuzu_soda", "YUZU SODA", 9, 0, 21, 6, 1.25, "Bright enough to remind the harbour morning still exists."),
    ],
    "Night workers deserve a place that knows their morning comes later.",
  ),
  business(
    "southline_diner",
    "SOUTHLINE DINER",
    "ROSA ALVAREZ",
    [-128, 0.2, -111],
    hours(20, 6),
    [
      item("night_bus_plate", "NIGHT-BUS BREAKFAST", 22, 7, 17, 32, 2.7, "Breakfast is a time of mind, not a number on a clock."),
      item("rosa_soup", "ROSA'S CHICKPEA SOUP", 16, 6, 10, 27, 2.35, "This pot has heard worse nights than yours. It still comes out warm."),
      item("cinnamon_cocoa", "CINNAMON COCOA", 10, 1, 16, 12, 1.55, "Hold the mug. Some problems can wait until your hands stop shaking."),
    ],
    "The late bus does not ask why you missed the early one. Neither do I.",
  ),
]);

export const PAY_FORWARD_ITEM = Object.freeze({
  id: "pay_a_meal_forward",
  name: "PAY A MEAL FORWARD",
  cost: 18,
  heal: 0,
  stamina: 0,
  appetite: 0,
  consumeSeconds: 0,
  purchaseLine: "I will put it on the board. No name, no debt attached.",
  payForward: true,
});

function minuteOfDayFromHours(value) {
  const hoursValue = finite(value, 12);
  return ((Math.floor(hoursValue * 60) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function normalizeMinute(value) {
  const minute = integer(value);
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function isBusinessOpen(value, timeValue = 12) {
  const openingHours = value?.openingHours ?? value?.hours ?? value;
  const openMinute = Number.isFinite(Number(openingHours?.openMinute))
    ? normalizeMinute(openingHours.openMinute)
    : normalizeMinute(finite(openingHours?.open, 0) * 60);
  const closeMinute = Number.isFinite(Number(openingHours?.closeMinute))
    ? normalizeMinute(openingHours.closeMinute)
    : normalizeMinute(finite(openingHours?.close, 24) * 60);
  const minute = Math.abs(finite(timeValue)) <= 24
    ? minuteOfDayFromHours(timeValue)
    : normalizeMinute(timeValue);
  if (openMinute === closeMinute) return true;
  if (closeMinute > openMinute) return minute >= openMinute && minute < closeMinute;
  return minute >= openMinute || minute < closeMinute;
}

function squaredDistance(a, b) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

function readPositionOverride(positions, id) {
  if (!positions) return null;
  if (positions instanceof Map) return positions.get(id) ?? null;
  return positions[id] ?? null;
}

function configuredBusinesses(definitions, positions) {
  const source = Array.isArray(definitions) && definitions.length
    ? definitions
    : DEFAULT_NEIGHBOURHOOD_BUSINESSES;
  const ids = new Set();
  return Object.freeze(source.map((definition, index) => {
    const id = String(definition?.id ?? `business_${index}`);
    if (ids.has(id)) throw new RangeError(`Duplicate neighbourhood business id: ${id}`);
    ids.add(id);
    const fixedItems = Array.from(definition?.items ?? []).slice(0, 3);
    if (fixedItems.length !== 3) throw new RangeError(`Neighbourhood business ${id} requires exactly three fixed items.`);
    const normalizedItems = fixedItems.map((sourceItem, itemIndex) => Object.freeze({
      id: String(sourceItem?.id ?? `${id}_item_${itemIndex}`),
      name: String(sourceItem?.name ?? sourceItem?.label ?? `ITEM ${itemIndex + 1}`),
      cost: Math.max(0, integer(sourceItem?.cost)),
      heal: Math.max(0, finite(sourceItem?.heal)),
      stamina: Math.max(0, finite(sourceItem?.stamina)),
      appetite: Math.max(0, finite(sourceItem?.appetite)),
      consumeSeconds: Math.max(0, finite(sourceItem?.consumeSeconds, 2)),
      purchaseLine: String(sourceItem?.purchaseLine ?? "Take a breath while it is warm."),
      payForward: false,
    }));
    const suppliedHours = definition?.openingHours ?? definition?.hours ?? hours(7, 21);
    const open = clamp(suppliedHours.open ?? finite(suppliedHours.openMinute) / 60, 0, 24);
    const close = clamp(suppliedHours.close ?? finite(suppliedHours.closeMinute, 24 * 60) / 60, 0, 24);
    const openingHours = hours(open, close);
    const menu = Object.freeze([...normalizedItems, PAY_FORWARD_ITEM]);
    return Object.freeze({
      id,
      name: String(definition?.name ?? id).toUpperCase(),
      keeperName: String(definition?.keeperName ?? "SHOPKEEPER").toUpperCase(),
      position: point(readPositionOverride(positions, id) ?? definition?.position),
      openingHours,
      items: Object.freeze(normalizedItems),
      menu,
      welcome: String(definition?.welcome ?? "Come in. There is time to eat."),
    });
  }));
}

function businessView(definition, open, distance = null) {
  return Object.freeze({
    id: definition.id,
    name: definition.name,
    keeperName: definition.keeperName,
    position: definition.position,
    openingHours: definition.openingHours,
    open,
    distance,
    itemCount: definition.menu.length,
  });
}

function rejected(reason, businessId = null, itemId = null) {
  return Object.freeze({ accepted: false, reason, businessId, itemId });
}

function appetiteState(appetite) {
  if (appetite >= 78) return ["WELL FED", 1.08];
  if (appetite >= 42) return ["STEADY", 1];
  if (appetite >= 16) return ["PECKISH", 0.92];
  return ["HUNGRY", 0.82];
}

function weatherLabel(value) {
  const normalized = String(value ?? "CLEAR").trim().toUpperCase();
  if (normalized.includes("STORM")) return "STORM";
  if (normalized.includes("RAIN") || normalized.includes("DRIZZLE")) return "RAIN";
  return "CLEAR";
}

function storyChoice(context) {
  return String(
    context?.choiceResult ?? context?.storyChoice ?? context?.story?.choiceResult ?? "",
  ).trim().toLowerCase();
}

function storyPhase(context) {
  return String(
    context?.storyPhase ?? context?.story?.phase ?? context?.chapter ?? "",
  ).trim().toLowerCase();
}

/**
 * Renderer-independent neighbourhood routine. It owns social/familiarity and
 * appetite state only. Cash, health and player stats stay with the caller and
 * can be changed exactly once from a successful purchase transaction.
 */
export function createNeighbourhoodRoutine({
  businesses: suppliedBusinesses = DEFAULT_NEIGHBOURHOOD_BUSINESSES,
  positions = null,
  businessPositions = positions,
  interactionRadius = DEFAULT_INTERACTION_RADIUS,
  initialAppetite = 72,
  appetiteDecayPerSecond = 0.012,
} = {}) {
  const businesses = configuredBusinesses(suppliedBusinesses, businessPositions);
  const indexById = new Map(businesses.map((definition, index) => [definition.id, index]));
  const radiusSquared = Math.max(0.5, finite(interactionRadius, DEFAULT_INTERACTION_RADIUS)) ** 2;
  const decayRate = clamp(appetiteDecayPerSecond, 0, 1);

  let activeBusinessIndex = -1;
  let menuOpen = false;
  let selectionIndex = 0;
  let appetite = clamp(initialAppetite, 0, 100);
  let transactionSerial = 0;
  let lastEvent = "routine_ready";
  let keeperLine = "";
  let lineReason = "none";
  let dayIndex = 0;
  let minuteOfDay = minuteOfDayFromHours(12);
  let previousMinuteOfDay = minuteOfDay;
  let weather = "CLEAR";
  let rememberedChoice = "";
  let rememberedStoryPhase = "";

  const familiarity = new Array(businesses.length).fill(0);
  const lastVisitDay = new Array(businesses.length).fill(-1);
  const pendingPayForwardDay = new Array(businesses.length).fill(-1);
  const pendingPayForwardCount = new Array(businesses.length).fill(0);
  const acknowledgedPayForwards = new Array(businesses.length).fill(0);
  const availableViewsByOpenMask = new Map();
  const runtimeView = { menuOpen: false, recoveryMultiplier: 1 };

  let consumeBusinessIndex = -1;
  let consumeItemIndex = -1;
  let consumeElapsed = 0;
  let consumeDuration = 0;

  function activeBusiness() {
    return businesses[activeBusinessIndex] ?? null;
  }

  function selectedItem() {
    const definition = activeBusiness();
    return definition?.menu[selectionIndex] ?? null;
  }

  function consuming() {
    return consumeBusinessIndex >= 0 && consumeItemIndex >= 0 && consumeDuration > 0 && consumeElapsed < consumeDuration;
  }

  function syncContext(context = {}) {
    const explicitDay = context.dayIndex ?? context.gameDay ?? context.day;
    let nextMinute = minuteOfDay;
    if (context.minuteOfDay != null) nextMinute = normalizeMinute(context.minuteOfDay);
    else if (context.timeMinutes != null) nextMinute = normalizeMinute(context.timeMinutes);
    else if (context.timeHours != null) nextMinute = minuteOfDayFromHours(context.timeHours);
    else if (context.hours != null) nextMinute = minuteOfDayFromHours(context.hours);

    if (explicitDay != null) dayIndex = Math.max(0, integer(explicitDay));
    else if (nextMinute < previousMinuteOfDay - MINUTES_PER_DAY / 2) dayIndex += 1;
    previousMinuteOfDay = nextMinute;
    minuteOfDay = nextMinute;
    if (context.weather != null) weather = weatherLabel(context.weather);
    const choice = storyChoice(context);
    const phase = storyPhase(context);
    if (choice) rememberedChoice = choice;
    if (phase) rememberedStoryPhase = phase;
  }

  function currentlyOpen(definition) {
    // Values at or below 24 are intentionally interpreted as public API hours;
    // offset internal minute values so 00:20 cannot be mistaken for 20:00.
    return isBusinessOpen(definition, minuteOfDay + MINUTES_PER_DAY);
  }

  function authoredKeeperLine(index, acknowledgement = false) {
    const definition = businesses[index];
    if (acknowledgement) {
      const count = pendingPayForwardCount[index];
      const plural = count === 1 ? "meal" : `${count} meals`;
      return `${definition.keeperName}: Your ${plural} reached someone after the last buses. They asked me to say it felt like being seen.`;
    }
    if (rememberedChoice === "publish") {
      return `${definition.keeperName}: Telling the truth moved the danger; it did not erase it. Eat, then check who had to carry it.`;
    }
    if (rememberedChoice === "protect") {
      return `${definition.keeperName}: Protecting a name bought time. Make sure caution does not become a comfortable kind of silence.`;
    }
    if (rememberedStoryPhase && rememberedStoryPhase !== "free_roam" && rememberedStoryPhase !== "resolution") {
      return `${definition.keeperName}: Whatever is pulling you across town can wait for one honest meal.`;
    }
    if (weather === "STORM") {
      return `${definition.keeperName}: The storm makes strangers share an awning. Strange that it takes thunder to remind us.`;
    }
    if (weather === "RAIN") {
      return `${definition.keeperName}: Leave the rain at the mat. I kept something warm for whoever came through.`;
    }
    const hour = minuteOfDay / 60;
    if (hour >= 4.5 && hour < 10.5) {
      return `${definition.keeperName}: Morning is not a clean page, but it is another line to write.`;
    }
    if (hour >= 22 || hour < 4.5) {
      return `${definition.keeperName}: The city calls this late. For half my customers, it is the middle of a working day.`;
    }
    if (familiarity[index] >= 3) {
      return `${definition.keeperName}: Good to see you again. Familiar should mean welcome, never obligation.`;
    }
    return `${definition.keeperName}: ${definition.welcome}`;
  }

  function refreshKeeperLine(index) {
    const acknowledgement = pendingPayForwardCount[index] > 0 && dayIndex > pendingPayForwardDay[index];
    keeperLine = authoredKeeperLine(index, acknowledgement);
    if (acknowledgement) {
      lineReason = "pay_forward_acknowledgement";
      acknowledgedPayForwards[index] += pendingPayForwardCount[index];
      pendingPayForwardCount[index] = 0;
      pendingPayForwardDay[index] = -1;
    } else if (rememberedChoice) lineReason = `story_${rememberedChoice}`;
    else if (rememberedStoryPhase && rememberedStoryPhase !== "free_roam" && rememberedStoryPhase !== "resolution") lineReason = "story_in_progress";
    else if (weather === "STORM") lineReason = "weather_storm";
    else if (weather === "RAIN") lineReason = "weather_rain";
    else if (minuteOfDay >= 22 * 60 || minuteOfDay < 4.5 * 60) lineReason = "time_night";
    else if (minuteOfDay >= 4.5 * 60 && minuteOfDay < 10.5 * 60) lineReason = "time_morning";
    else if (familiarity[index] >= 3) lineReason = "familiar";
    else lineReason = "welcome";
  }

  function nearby(positionValue, radiusOrContext = 7, maybeContext = {}) {
    const radius = typeof radiusOrContext === "number" ? Math.max(0, radiusOrContext) : 7;
    const context = typeof radiusOrContext === "object" ? radiusOrContext : maybeContext;
    syncContext(context);
    const position = point(positionValue);
    const maximum = radius * radius;
    let nearestIndex = -1;
    let nearestSquared = maximum;
    for (let index = 0; index < businesses.length; ++index) {
      const squared = squaredDistance(position, businesses[index].position);
      if (squared <= nearestSquared) {
        nearestIndex = index;
        nearestSquared = squared;
      }
    }
    if (nearestIndex < 0) return null;
    const definition = businesses[nearestIndex];
    return businessView(definition, currentlyOpen(definition), Math.sqrt(nearestSquared));
  }

  function resolveBusinessIndex(value) {
    const id = typeof value === "object" ? value?.id ?? value?.businessId : value;
    return indexById.get(String(id ?? "")) ?? -1;
  }

  function openMenu(value, context = {}) {
    syncContext(context);
    const index = resolveBusinessIndex(value);
    if (index < 0) return rejected("unknown_business", String(value?.id ?? value ?? "") || null);
    const definition = businesses[index];
    if (context.inVehicle) return rejected("on_foot_required", definition.id);
    if (!currentlyOpen(definition)) return rejected("closed", definition.id);
    if (context.position != null && squaredDistance(point(context.position), definition.position) > radiusSquared) {
      return rejected("too_far", definition.id);
    }
    activeBusinessIndex = index;
    menuOpen = true;
    selectionIndex = 0;
    if (lastVisitDay[index] !== dayIndex) {
      familiarity[index] += 1;
      lastVisitDay[index] = dayIndex;
    }
    refreshKeeperLine(index);
    lastEvent = "menu_opened";
    return snapshot();
  }

  function moveSelection(direction = 1) {
    if (!menuOpen || activeBusinessIndex < 0) return snapshot();
    const menuLength = activeBusiness().menu.length;
    let movement = 0;
    if (typeof direction === "string") {
      const normalized = direction.toLowerCase();
      movement = normalized === "up" || normalized === "previous" || normalized === "prev" ? -1 :
        normalized === "down" || normalized === "next" ? 1 : integer(direction);
    } else movement = integer(direction);
    if (movement === 0) return snapshot();
    selectionIndex = ((selectionIndex + movement) % menuLength + menuLength) % menuLength;
    lastEvent = "selection_moved";
    return snapshot();
  }

  function purchase(contextValue = {}) {
    const context = typeof contextValue === "number" ? { cash: contextValue } : contextValue;
    syncContext(context);
    const definition = activeBusiness();
    const selected = selectedItem();
    if (!menuOpen || !definition || !selected) return rejected("menu_closed");
    if (context.inVehicle) return rejected("on_foot_required", definition.id, selected.id);
    if (!currentlyOpen(definition)) {
      menuOpen = false;
      lastEvent = "business_closed";
      return rejected("closed", definition.id, selected.id);
    }
    if (consuming()) return rejected("still_consuming", definition.id, selected.id);
    const cash = finite(context.cash ?? context.money ?? context.balance, 0);
    if (cash + 1e-9 < selected.cost) return rejected("insufficient_cash", definition.id, selected.id);

    transactionSerial += 1;
    appetite = clamp(appetite + selected.appetite, 0, 100);
    if (selected.payForward) {
      if (pendingPayForwardCount[activeBusinessIndex] === 0) pendingPayForwardDay[activeBusinessIndex] = dayIndex;
      pendingPayForwardCount[activeBusinessIndex] += 1;
      keeperLine = `${definition.keeperName}: ${selected.purchaseLine}`;
      lineReason = "pay_forward_purchase";
      lastEvent = "meal_paid_forward";
    } else {
      consumeBusinessIndex = activeBusinessIndex;
      consumeItemIndex = selectionIndex;
      consumeElapsed = 0;
      consumeDuration = selected.consumeSeconds;
      keeperLine = `${definition.keeperName}: ${selected.purchaseLine}`;
      lineReason = "purchase";
      lastEvent = "purchase_accepted";
    }
    return Object.freeze({
      accepted: true,
      serial: transactionSerial,
      businessId: definition.id,
      itemId: selected.id,
      cost: selected.cost,
      heal: selected.heal,
      stamina: selected.stamina,
      appetite: selected.appetite,
      line: keeperLine,
    });
  }

  function close(reason = "player_closed") {
    menuOpen = false;
    activeBusinessIndex = -1;
    selectionIndex = 0;
    keeperLine = "";
    lineReason = "none";
    lastEvent = String(reason || "player_closed");
    return snapshot();
  }

  function update(deltaValue, context = {}) {
    syncContext(context);
    const delta = clamp(deltaValue, 0, 60);
    if (!context.paused) appetite = clamp(appetite - delta * decayRate, 0, 100);
    if (consuming()) {
      consumeElapsed = Math.min(consumeDuration, consumeElapsed + delta);
      if (consumeElapsed + 1e-9 >= consumeDuration) lastEvent = "meal_finished";
    }
    const definition = activeBusiness();
    if (menuOpen && definition && !currentlyOpen(definition)) {
      menuOpen = false;
      activeBusinessIndex = -1;
      selectionIndex = 0;
      keeperLine = "";
      lineReason = "none";
      lastEvent = "business_closed";
    }
    if (context.captureSnapshot === false) {
      runtimeView.menuOpen = menuOpen;
      runtimeView.recoveryMultiplier = appetiteState(appetite)[1];
      return runtimeView;
    }
    return snapshot();
  }

  function save() {
    return {
      version: NEIGHBOURHOOD_ROUTINE_SAVE_VERSION,
      activeBusinessId: activeBusiness()?.id ?? null,
      menuOpen,
      selectionIndex,
      appetite,
      transactionSerial,
      lastEvent,
      keeperLine,
      lineReason,
      dayIndex,
      minuteOfDay,
      previousMinuteOfDay,
      weather,
      rememberedChoice,
      rememberedStoryPhase,
      familiarity: [...familiarity],
      lastVisitDay: [...lastVisitDay],
      pendingPayForwardDay: [...pendingPayForwardDay],
      pendingPayForwardCount: [...pendingPayForwardCount],
      acknowledgedPayForwards: [...acknowledgedPayForwards],
      consumeBusinessId: businesses[consumeBusinessIndex]?.id ?? null,
      consumeItemIndex,
      consumeElapsed,
      consumeDuration,
    };
  }

  function restore(value = {}) {
    if (Number(value.version ?? NEIGHBOURHOOD_ROUTINE_SAVE_VERSION) !== NEIGHBOURHOOD_ROUTINE_SAVE_VERSION) {
      throw new RangeError("Unsupported neighbourhood routine save version.");
    }
    activeBusinessIndex = resolveBusinessIndex(value.activeBusinessId);
    menuOpen = Boolean(value.menuOpen) && activeBusinessIndex >= 0;
    selectionIndex = menuOpen
      ? Math.max(0, Math.min(activeBusiness().menu.length - 1, integer(value.selectionIndex)))
      : 0;
    appetite = clamp(value.appetite, 0, 100);
    transactionSerial = Math.max(0, integer(value.transactionSerial));
    lastEvent = String(value.lastEvent ?? "routine_restored");
    keeperLine = menuOpen ? String(value.keeperLine ?? "") : "";
    lineReason = menuOpen ? String(value.lineReason ?? "none") : "none";
    dayIndex = Math.max(0, integer(value.dayIndex));
    minuteOfDay = normalizeMinute(value.minuteOfDay);
    previousMinuteOfDay = normalizeMinute(value.previousMinuteOfDay ?? minuteOfDay);
    weather = weatherLabel(value.weather);
    rememberedChoice = String(value.rememberedChoice ?? "");
    rememberedStoryPhase = String(value.rememberedStoryPhase ?? "");

    function restoreArray(target, source, minimum = -1) {
      for (let index = 0; index < target.length; ++index) {
        target[index] = Math.max(minimum, integer(source?.[index], minimum));
      }
    }
    restoreArray(familiarity, value.familiarity, 0);
    restoreArray(lastVisitDay, value.lastVisitDay, -1);
    restoreArray(pendingPayForwardDay, value.pendingPayForwardDay, -1);
    restoreArray(pendingPayForwardCount, value.pendingPayForwardCount, 0);
    restoreArray(acknowledgedPayForwards, value.acknowledgedPayForwards, 0);

    consumeBusinessIndex = resolveBusinessIndex(value.consumeBusinessId);
    consumeItemIndex = consumeBusinessIndex >= 0
      ? Math.max(-1, Math.min(2, integer(value.consumeItemIndex, -1)))
      : -1;
    consumeDuration = consumeItemIndex >= 0 ? Math.max(0, finite(value.consumeDuration)) : 0;
    consumeElapsed = consumeDuration > 0 ? clamp(value.consumeElapsed, 0, consumeDuration) : 0;
    return snapshot();
  }

  function snapshot() {
    const definition = activeBusiness();
    const selected = selectedItem();
    const consumeDefinition = businesses[consumeBusinessIndex] ?? null;
    const consumeItem = consumeDefinition?.menu[consumeItemIndex] ?? null;
    const [statusLabel, recoveryMultiplier] = appetiteState(appetite);
    const businessFamiliarity = activeBusinessIndex >= 0 ? familiarity[activeBusinessIndex] : 0;
    return Object.freeze({
      active: menuOpen,
      menuOpen,
      businessId: definition?.id ?? null,
      businessName: definition?.name ?? null,
      keeperName: definition?.keeperName ?? null,
      position: definition?.position ?? null,
      openingHours: definition?.openingHours ?? null,
      open: definition ? currentlyOpen(definition) : false,
      menuItems: definition?.menu ?? null,
      selectionIndex,
      selectedItem: selected,
      keeperLine,
      lineReason,
      familiarity: businessFamiliarity,
      dayIndex,
      minuteOfDay,
      timeHours: minuteOfDay / 60,
      weather,
      appetite,
      appetiteStatus: statusLabel,
      statusLabel,
      recoveryMultiplier,
      consuming: consuming(),
      consumeItemId: consumeItem?.id ?? null,
      consumeBusinessId: consumeDefinition?.id ?? null,
      consumeElapsed,
      consumeDuration,
      consumeProgress: consumeDuration > 0 ? clamp(consumeElapsed / consumeDuration, 0, 1) : 0,
      transactionSerial,
      lastEvent,
      pendingPayForwards: activeBusinessIndex >= 0 ? pendingPayForwardCount[activeBusinessIndex] : 0,
      acknowledgedPayForwards: activeBusinessIndex >= 0 ? acknowledgedPayForwards[activeBusinessIndex] : 0,
      businessCount: businesses.length,
    });
  }

  function prewarm() {
    const previous = save();
    const definition = businesses[0];
    const sampleDay = dayIndex + 2;
    const samplePosition = definition.position;
    nearby(samplePosition, 8, { dayIndex: sampleDay, timeHours: definition.openingHours.open + 0.5, weather: "RAIN" });
    openMenu(definition.id, { dayIndex: sampleDay, timeHours: definition.openingHours.open + 0.5, position: samplePosition, storyPhase: "meet_juno" });
    moveSelection(1);
    purchase({ cash: 9999, dayIndex: sampleDay, timeHours: definition.openingHours.open + 0.5 });
    update(10, { dayIndex: sampleDay, timeHours: definition.openingHours.open + 0.5 });
    close();
    openMenu(definition.id, { dayIndex: sampleDay, timeHours: definition.openingHours.open + 0.5, position: samplePosition });
    moveSelection(-1);
    purchase({ cash: 9999, dayIndex: sampleDay, timeHours: definition.openingHours.open + 0.5 });
    close();
    openMenu(definition.id, { dayIndex: sampleDay + 1, timeHours: definition.openingHours.open + 0.5, position: samplePosition });
    const acknowledgementPrepared = lineReason === "pay_forward_acknowledgement";
    restore(previous);
    return Object.freeze({
      menusPrepared: businesses.length,
      purchasePrepared: true,
      consumePrepared: true,
      acknowledgementPrepared,
      storage: "memory-only",
    });
  }

  function available(context = {}) {
    syncContext(context);
    let openMask = 0;
    for (let index = 0; index < businesses.length; ++index) {
      if (currentlyOpen(businesses[index])) openMask |= 1 << index;
    }
    let views = availableViewsByOpenMask.get(openMask);
    if (!views) {
      views = Object.freeze(businesses.map((definition, index) =>
        businessView(definition, Boolean(openMask & (1 << index)))));
      availableViewsByOpenMask.set(openMask, views);
    }
    return views;
  }

  return Object.freeze({
    nearby,
    open: openMenu,
    openMenu,
    moveSelection,
    purchase,
    close,
    update,
    save,
    restore,
    snapshot,
    prewarm,
    available,
    businesses,
  });
}

export const createNeighbourhoodRoutineSystem = createNeighbourhoodRoutine;
