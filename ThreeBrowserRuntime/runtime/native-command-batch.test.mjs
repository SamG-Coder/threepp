import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../host/ThreeBrowser/web/three/00-cmdbuf.js", import.meta.url), "utf8");
function harness() {
  let shared = new ArrayBuffer(8 * 1024 * 1024);
  const submissions = [];
  const host = {
    CmdSubmit: used => submissions.push(Buffer.from(new Uint8Array(shared, 0, used))),
    ResizeCmdBuffer: bytes => (shared = new ArrayBuffer(2 ** Math.ceil(Math.log2(bytes)))),
  };
  const context = vm.createContext({ ArrayBuffer, Uint8Array, Uint32Array, Float32Array, TextEncoder,
    __TN_SHARED: shared, chrome: { webview: { hostObjects: { sync: { native: host } } } },
  });
  vm.runInContext(source, context);
  return { cmd: context.__TN.cmd, submissions };
}

test("numeric uniforms remain ordered in a batch with aligned names and signed integers", () => {
  const { cmd, submissions } = harness();
  cmd.matVertexColors(7, true);
  cmd.shaderUniform(7, "time", 1, [1.25]);
  cmd.shaderUniform(7, "mode", 2, [-3]);
  cmd.shaderUniform(7, "sun", 4, [0.1, 0.2, 0.3]);
  cmd.submit();
  assert.equal(submissions.length, 1);
  const buffer = submissions[0];
  const commands = [];
  for (let offset = 0; offset < buffer.length; offset += buffer.readUInt32LE(offset + 4)) {
    commands.push(buffer.subarray(offset, offset + buffer.readUInt32LE(offset + 4)));
  }
  assert.deepEqual(commands.map(command => command.readUInt32LE(0)), [57, 58, 58, 58]);
  assert.equal(commands[1].readFloatLE(28), 1.25);
  assert.equal(commands[2].readInt32LE(28), -3);
  assert.equal(commands[3].subarray(24, 27).toString(), "sun");
  assert.ok(Math.abs(commands[3].readFloatLE(36) - 0.3) < 1e-6);
});

test("a terrain upload larger than the initial ring preserves the preceding commands", () => {
  const { cmd, submissions } = harness();
  cmd.matVertexColors(7, true);
  const positions = new Float32Array(2_100_000);
  positions[0] = 3.5;
  positions[positions.length - 1] = 8.25;
  cmd.bufGeo(8, positions, null, null, null);
  cmd.submit();
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].readUInt32LE(0), 57);
  assert.equal(submissions[1].readUInt32LE(0), 30);
  assert.equal(submissions[1].readFloatLE(32), 3.5);
  assert.equal(submissions[1].readFloatLE(32 + (positions.length - 1) * 4), 8.25);
});
