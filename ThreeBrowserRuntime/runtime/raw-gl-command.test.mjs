import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../host/ThreeBrowser/web/three/00-cmdbuf.js',import.meta.url),'utf8');
function harness(capacity=128) {
  const submitted=[];let rejected=false;
  const context=vm.createContext({ArrayBuffer,Uint8Array,Uint32Array,Float32Array,Float64Array,TextEncoder,performance,setTimeout,clearTimeout});
  context.__TN_SHARED=new ArrayBuffer(capacity);
  context.chrome={webview:{hostObjects:{sync:{native:{
    CmdSubmit(used){submitted.push(new Uint8Array(context.__TN_SHARED.slice(0,used)));return !rejected;},
    ResizeCmdBuffer(size){return context.__TN_SHARED=new ArrayBuffer(Math.ceil(size/8)*8);}
  }}}}};
  vm.runInContext(source,context);
  return {cmd:context.__TN.cmd,submitted,reject(){rejected=true;}};
}
test('direct GL uses main command framing, rollover and exact numeric arguments',()=>{
  const h=harness(),data=new Uint8Array([7,8,9]);
  h.cmd.rawGL(43,[2**40+.25,-3],data);data.fill(99);
  h.cmd.rawGL(44,[5],null);h.cmd.submit();
  assert.equal(h.submitted.length,2);
  const view=new DataView(h.submitted[0].buffer);
  assert.equal(view.getUint32(0,true),h.cmd.OP.RAW_GL);
  assert.equal(view.getUint32(4,true),104);
  assert.equal(view.getUint32(8,true),43);
  assert.equal(view.getUint32(12,true),3);
  assert.equal(view.getFloat64(16,true),2**40+.25);
  assert.equal(view.getFloat64(24,true),-3);
  assert.deepEqual([...h.submitted[0].slice(96,99)],[7,8,9]);
});
test('direct GL grows the shared main buffer and rolls back invalid commands',()=>{
  const h=harness();h.cmd.rawGL(43,[],new Uint8Array(1000));h.cmd.submit();
  assert.equal(h.submitted[0].length,1096);
  assert.throws(()=>h.cmd.rawGL(43,[NaN],null),/finite/);
  h.cmd.rawGL(44,[1],null);h.cmd.submit();
  assert.equal(h.submitted[1].length,96);
  h.cmd.rawGL(44,[2],null);h.reject();assert.throws(()=>h.cmd.submit(),/submission failed/);
});

// Real generated opcodes ensure that the optimizer follows the wire protocol.
import {OPS} from './raw-gl-generated.mjs';
test('uniform elision preserves changed values across draws and owns snapshots',()=>{
  const h=harness(8192);h.cmd.configureRawGL(OPS);
  const matrix=new Float32Array(9);matrix[0]=1;
  const upload=()=>h.cmd.rawGL(OPS.uniformMatrix3fv,[4,0],matrix);
  upload();h.cmd.rawGL(OPS.drawArrays,[4,0,3]);upload();
  matrix[0]=2;upload();h.cmd.rawGL(OPS.drawArrays,[4,0,3]);upload();
  matrix[0]=1;upload();h.cmd.submit();
  // Parse manually because draws have no payload.
  const bytes=h.submitted[0],view=new DataView(bytes.buffer),values=[];
  for(let offset=0;offset<bytes.length;offset+=view.getUint32(offset+4,true))
    if(view.getUint32(offset+8,true)===OPS.uniformMatrix3fv)values.push(view.getFloat32(offset+96,true));
  assert.deepEqual(values,[1,2,1]);
  assert.equal(h.cmd.rawGLStats.uniformSkipped,2);
});
test('uniform cache respects program, query and overlapping array barriers',()=>{
  const h=harness(8192);h.cmd.configureRawGL(OPS);
  const upload=()=>h.cmd.rawGL(OPS.uniform1fv,[7],new Float32Array([3]));
  upload();upload();
  for(const op of [OPS.useProgram,OPS.linkProgram,OPS.deleteProgram]) {
    h.cmd.rawGL(op,[1]);upload();
  }
  h.cmd.invalidateRawGL();upload();
  h.cmd.rawGL(OPS.uniform1fv,[6],new Float32Array([1,2]));upload();
  h.cmd.submit();assert.equal(h.cmd.rawGLStats.uniformSkipped,1);
  h.cmd.configureRawGL(OPS,false);upload();upload();h.cmd.submit();
  assert.equal(h.submitted[1].length,208);
});
test('uniform cache survives ring rollover without losing observed values',()=>{
  const h=harness(160);h.cmd.configureRawGL(OPS);
  const upload=value=>h.cmd.rawGL(OPS.uniform1f,[3,value]);
  upload(1);h.cmd.rawGL(OPS.drawArrays,[4,0,3]);upload(1);upload(2);h.cmd.submit();
  assert.equal(h.submitted.length,3);
  assert.equal(h.cmd.rawGLStats.uniformSkipped,1);
  const last=new DataView(h.submitted[2].buffer);
  assert.equal(last.getFloat64(24,true),2);
});
test('instance buffer writes coalesce only before an intervening observer or bind',()=>{
  const h=harness(8192);h.cmd.configureRawGL(OPS,true,false);
  const upload=value=>h.cmd.rawGL(OPS.bufferSubData,[34962,16],new Float32Array([value]));
  upload(1);upload(2);
  h.cmd.rawGL(OPS.drawArrays,[4,0,3]);upload(3);
  h.cmd.rawGL(OPS.bindBuffer,[34962,2]);upload(4);
  h.cmd.submit();upload(5);h.cmd.submit();
  assert.equal(h.cmd.rawGLStats.bufferUploadsCoalesced,1);
  const values=[];
  for(const bytes of h.submitted) {
    const view=new DataView(bytes.buffer);
    for(let offset=0;offset<bytes.length;offset+=view.getUint32(offset+4,true))
      if(view.getUint32(offset+8,true)===OPS.bufferSubData)values.push(view.getFloat32(offset+96,true));
  }
  assert.deepEqual(values,[2,3,4,5]);
});
test('buffer coalescing respects range, size, query and rollover boundaries',()=>{
  const h=harness(104);h.cmd.configureRawGL(OPS,true,false);
  h.cmd.rawGL(OPS.bufferSubData,[34962,0],new Uint8Array([1,2,3,4]));
  h.cmd.rawGL(OPS.bufferSubData,[34962,4],new Uint8Array([5,6,7,8]));
  h.cmd.rawGL(OPS.bufferSubData,[34962,4],new Uint8Array([9]));
  h.cmd.invalidateRawGL();
  h.cmd.rawGL(OPS.bufferSubData,[34962,4],new Uint8Array([10]));
  h.cmd.submit();
  assert.equal(h.submitted.length,4);
  assert.equal(h.cmd.rawGLStats.bufferUploadsCoalesced,0);
});
test('failed submission invalidates previously cached uniforms',()=>{
  const h=harness(1024);h.cmd.configureRawGL(OPS);
  h.cmd.rawGL(OPS.uniform1f,[3,1]);h.reject();assert.throws(()=>h.cmd.submit());
  h.cmd.rawGL(OPS.uniform1f,[3,1]);assert.throws(()=>h.cmd.submit());
  assert.equal(h.cmd.rawGLStats.uniformSkipped,0);
});
