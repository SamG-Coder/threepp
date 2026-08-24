import assert from "node:assert/strict";
import net from "node:net";

const pipePath = process.argv[2];
if (!pipePath) {
  throw new TypeError("Usage: node tests/live-playtest.mjs <named-pipe-path>");
}

class ControlClient {
  constructor(path) {
    this.socket = net.createConnection(path);
    this.socket.setEncoding("utf8");
    this.buffer = "";
    this.sequence = 0;
    this.pending = new Map();
    this.socket.on("data", chunk => this.#consume(chunk));
    this.socket.on("error", error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  async ready() {
    if (!this.socket.connecting) return;
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
  }

  request(op, values = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Control request timed out: ${op}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      this.socket.write(JSON.stringify({ id, op, ...values }) + "\n");
    });
  }

  close() {
    this.socket.end();
  }

  #consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "Control request failed"));
    }
  }
}

function actor(snapshot, id) {
  return snapshot.actors.find(entry => entry.id === id) ?? null;
}

function actorByPrefix(snapshot, prefix) {
  return snapshot.actors.find(entry => entry.id.startsWith(prefix)) ?? null;
}

async function main() {
  const control = new ControlClient(pipePath);
  await control.ready();
  try {
    assert.equal((await control.request("ping")).pong, true);
    let state = await control.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.game.quest.stageId, "speak_to_elder");

    // Native input may retain a physical key that was down while the hidden
    // test window acquired focus. Explicit releases make the scripted combat
    // probe independent of the operator's desktop state.
    for (const code of [
      "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown",
      "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight",
    ]) {
      await control.request("key", { code, down: false });
    }

    // Exercise the actual player attack state machine against a pooled live
    // enemy before using deterministic controls to cover the long quest loop.
    await control.request("teleport", { x: 0, z: 142 });
    const wolf = await control.request("spawn", { archetype: "wolf", x: 0, z: 140.55 });
    await control.request("face", { target: wolf.id });
    await control.request("action", { action: "lightAttack" });
    await control.request("advance", { steps: 45 });
    state = await control.request("snapshot");
    const struckWolf = actor(state, wolf.id);
    assert.ok(!struckWolf?.alive || struckWolf.health < 62,
      "a live light-attack window should damage the spawned wolf");

    let elder = actor(state, "elder_mara");
    assert.ok(elder?.alive, "Elder Mara must be alive for the main quest");
    await control.request("teleport", { x: elder.position[0], z: elder.position[2] + 1 });
    await control.request("interact");
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "inspect_beacon");
    await control.request("interact"); // close dialogue

    const interactAt = async (x, z, times = 1) => {
      await control.request("teleport", { x, z });
      const targets = [];
      for (let index = 0; index < times; ++index) {
        targets.push((await control.request("interact")).target);
      }
      return targets;
    };

    assert.deepEqual(await interactAt(-20, -30.8), ["village_beacon"]);
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "obtain_resin");

    assert.deepEqual(await interactAt(-73, -104, 3), ["pine_resin", "pine_resin", "pine_resin"]);
    assert.deepEqual(await interactAt(-102, -65, 2), ["seasoned_wood", "seasoned_wood"]);
    assert.deepEqual(await interactAt(-72, 111), ["west_field_crop"]);
    state = await control.request("snapshot");
    const quantities = Object.fromEntries(state.game.inventory.stacks.map(stack => [stack.itemId, stack.quantity]));
    assert.equal(quantities.pine_resin, 3);
    assert.equal(quantities.seasoned_wood, 2);
    assert.ok(quantities.cloth >= 1);

    assert.deepEqual(await interactAt(-115, -69), ["hunter_camp_bedroll"]);
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "obtain_iron_fittings");

    const brynna = actor(state, "brynna-vale");
    assert.ok(brynna?.alive, "Brynna must survive to forge the beacon fittings");
    await control.request("teleport", { x: brynna.position[0], z: brynna.position[2] + 1 });
    await control.request("interact");
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "defend_repairs");
    await control.request("interact"); // close dialogue

    await control.request("quest", {
      event: { type: "defend", target: "beacon_repair_site", amount: 1 },
    });
    assert.deepEqual(await interactAt(-20, -30.8), ["village_beacon"]);
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "follow_signal");
    assert.equal(state.game.progression.beaconLit, true);
    assert.equal(state.game.progression.fortressRouteUnlocked, true);

    await control.request("teleport", { x: 0, z: -155 });
    await control.request("advance", { steps: 3 });
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "defeat_warden");
    const warden = actorByPrefix(state, "fortressWarden-");
    assert.ok(warden?.alive, "Fortress Warden should spawn at the revealed gate");

    await control.request("damage", { target: warden.id, amount: 400, poiseDamage: 260 });
    await control.request("advance", { steps: 3 });
    state = await control.request("snapshot");
    assert.equal(state.game.boss?.phase, 2, "Warden should enter phase two through real damage handling");

    await control.request("damage", { target: warden.id, amount: 400, poiseDamage: 260 });
    await control.request("advance", { steps: 3 });
    state = await control.request("snapshot");
    assert.equal(state.game.boss?.phase, 3, "Warden should enter phase three through real damage handling");

    await control.request("damage", { target: warden.id, amount: 400, poiseDamage: 260 });
    await control.request("advance", { steps: 3 });
    state = await control.request("snapshot");
    assert.equal(state.game.quest.stageId, "return_to_village");
    assert.equal(state.game.progression.wardenDefeated, true);

    elder = actor(state, "elder_mara");
    await control.request("teleport", { x: elder.position[0], z: elder.position[2] + 1 });
    await control.request("interact");
    state = await control.request("snapshot");
    assert.equal(state.game.quest.status, "completed");
    assert.equal(state.game.progression.postVictory, true);
    assert.equal(state.game.progression.mainQuestComplete, true);

    await control.request("interact"); // close victory dialogue
    await control.request("action", { action: "inventory" });
    await control.request("advance", { steps: 1 });
    state = await control.request("snapshot");
    assert.equal(state.game.panel?.kind, "inventory", "GPU inventory panel should open from the live input path");
    await control.request("action", { action: "cancel" });
    await control.request("advance", { steps: 1 });

    await control.request("time", { hour: 22 });
    await control.request("weather", { mode: "storm", transitionMinutes: 0 });
    await control.request("advance", { steps: 90 });
    state = await control.request("snapshot");
    assert.equal(state.game.time.phase, "night");
    assert.equal(state.game.weather.mode, "storm");
    assert.ok(state.game.weather.rain > 0.8);

    const save = await control.request("save");
    const savedPosition = save.player.position;
    await control.request("teleport", { x: 0, z: 178 });
    await control.request("restore", { snapshot: save });
    state = await control.request("snapshot");
    assert.deepEqual(actor(state, "player").position, savedPosition);

    console.log(JSON.stringify({
      ready: state.ready,
      quest: state.game.quest.status,
      postVictory: state.game.progression.postVictory,
      renderPath: state.render.label,
      wardenPhasesVerified: [2, 3],
      weather: state.game.weather.mode,
      time: state.game.time.phase,
      playerPositionRestored: true,
      actors: state.actors.length,
    }, null, 2));
  } finally {
    control.close();
  }
}

await main();
