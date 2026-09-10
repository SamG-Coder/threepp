import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../host/ThreeBrowser/web/three/00-cmdbuf.js", import.meta.url), "utf8");
function harness(Encoder = TextEncoder, capacity = 8 * 1024 * 1024) {
  let shared = new ArrayBuffer(capacity);
  const submissions = [];
  const host = {
    CmdSubmit: used => submissions.push(Buffer.from(new Uint8Array(shared, 0, used))),
    ResizeCmdBuffer: bytes => (shared = new ArrayBuffer(2 ** Math.ceil(Math.log2(bytes)))),
  };
  const context = vm.createContext({ ArrayBuffer, Uint8Array, Uint32Array, Float32Array, TextEncoder: Encoder,
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

function decodeMatrixCommands(submissions) {
  const events = [], opcodes = [];
  for (const buffer of submissions) {
    for (let offset = 0; offset < buffer.length;) {
      const op = buffer.readUInt32LE(offset), size = buffer.readUInt32LE(offset + 4);
      assert.ok(size >= 8 && size % 8 === 0 && offset + size <= buffer.length);
      opcodes.push(op);
      if (op === 100 || op === 103) {
        const handle = buffer.readUInt32LE(offset + 8), index = buffer.readUInt32LE(offset + 12);
        const count = op === 103 ? buffer.readUInt32LE(offset + 16) : 1;
        for (let i = 0; i < count; i++) {
          const data = offset + (op === 103 ? 20 : 16) + i * 64;
          events.push([handle, index + i, Array.from({ length: 16 }, (_,j) => buffer.readFloatLE(data+j*4))]);
        }
      } else events.push(op);
      offset += size;
    }
  }
  return { events, opcodes };
}

test("instance batches preserve snapshots, draw barriers, mesh changes and repeated indices", () => {
  const { cmd, submissions } = harness();
  const matrix = new Float32Array(16), expected = [];
  const write = (handle,index,value) => {
    matrix.fill(value); expected.push([handle,index,[...matrix]]); cmd.instMatrix(handle,index,matrix);
  };
  write(7,0,1); write(7,1,2); write(7,2,3);
  cmd.renderPass(20,21,22); expected.push(4);
  write(7,3,4); write(7,3,5); write(7,5,6); write(8,6,7); write(8,7,8);
  cmd.destroy(8); expected.push(86);
  write(8,8,9);
  cmd.submit();
  write(8,9,10); write(8,10,11); cmd.submit();
  const decoded = decodeMatrixCommands(submissions);
  assert.deepEqual(decoded.events, expected);
  assert.deepEqual(decoded.opcodes, [103,4,100,100,100,103,86,100,103]);
});

test("instance batches split safely at ring-buffer boundaries", () => {
  const { cmd, submissions } = harness(TextEncoder, 256);
  const matrix = new Float32Array(16), expected = [];
  for (let i=0;i<20;i++) {
    matrix.fill(i+.25); expected.push([7,i,[...matrix]]); cmd.instMatrix(7,i,matrix);
  }
  cmd.submit();
  assert.ok(submissions.length > 1);
  assert.deepEqual(decodeMatrixCommands(submissions).events, expected);
});

test('offset instance writes snapshot only 16 values without allocating subarray views', () => {
  const {cmd,submissions}=harness(TextEncoder,256);
  const storage=new Float32Array(16*12),expected=[];
  storage.subarray=()=>{throw new Error('unexpected matrix view allocation');};
  for(let i=0;i<12;i++) {
    storage.fill(i+.5,i*16,i*16+16);
    cmd.instMatrix(7,i,storage,i*16);
    expected.push([7,i,Array(16).fill(i+.5)]);
  }
  storage.fill(-1);cmd.submit();
  assert.deepEqual(decodeMatrixCommands(submissions).events,expected);
  assert.throws(()=>cmd.instMatrix(7,0,storage,storage.length-15),{name:'RangeError',message:'Instance matrix requires 16 source elements'});
});

test('light state transports changing attenuation and cone values', () => {
  const {cmd,submissions}=harness();
  const light={distance:60,decay:2,angle:.5,penumbra:.25};
  cmd.lightState(9,{r:1,g:.5,b:.25},120,null,null,light);cmd.submit();
  const payload=submissions[0];
  assert.equal(payload.readUInt32LE(4),72);
  assert.equal(payload.readFloatLE(52),60);assert.equal(payload.readFloatLE(56),2);
  assert.equal(payload.readFloatLE(60),.5);assert.equal(payload.readFloatLE(64),.25);
});

test("cached uniform names preserve UTF-8 bytes, changing values and texture command order", () => {
  let encodes = 0;
  class CountingEncoder extends TextEncoder {
    encode(value) { encodes++; return super.encode(value); }
  }
  const { cmd, submissions } = harness(CountingEncoder);
  const name = "lights[2].colour_é";
  const expected = Buffer.from(name);
  for (let frame = 0; frame < 3; frame++) {
    cmd.shaderUniform(7, name, 1, [frame + .25]);
    cmd.shaderTexture(8, name, 40 + frame);
    cmd.submit();
    const bytes = submissions[frame];
    assert.equal(bytes.readUInt32LE(0), 58);
    assert.equal(bytes.readUInt32LE(16), expected.length);
    assert.deepEqual(bytes.subarray(24, 24 + expected.length), expected);
    assert.equal(bytes.readFloatLE(24 + ((expected.length + 3) & ~3)), frame + .25);
    const next = bytes.readUInt32LE(4);
    assert.equal(bytes.readUInt32LE(next), 56);
    assert.equal(bytes.readUInt32LE(next + 12), 40 + frame);
    assert.deepEqual(bytes.subarray(next + 20, next + 20 + expected.length), expected);
  }
  assert.equal(encodes, 1, 'repeated names should be encoded once across both command types');
  for (let i = 0; i < 5000; i++) cmd.shaderUniform(7, `generated${i}`, 1, [i]);
  const before = encodes;
  cmd.shaderUniform(7, name, 1, [9]);
  assert.equal(encodes, before + 1, 'name churn must evict old entries rather than retain them forever');
  cmd.submit();
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
