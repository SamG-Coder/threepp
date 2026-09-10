import test from 'node:test';
import assert from 'node:assert/strict';
import {createRawGLContext} from './raw-gl.mjs';
import {OPS} from './raw-gl-generated.mjs';

function harness() {
  const previous=globalThis.__TN,calls=[];
  globalThis.__TN={cmd:{configureRawGL(){},rawGL(op,args,data){calls.push({op,args,data:data?.slice()});},submit(){},invalidateRawGL(){}}};
  const gl=createRawGLContext({rawGlCall(){},isOpen(){return true;}},{width:1,height:1});
  return {gl,calls,restore(){globalThis.__TN=previous;}};
}
test('decoded DOM images apply flip and premultiplication without mutating source',()=>{
  const h=harness(),gl=h.gl;
  try {
    const source={width:1,height:2,data:new Uint8Array([100,50,20,128,10,20,30,255])};
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,source);
    assert.deepEqual([...h.calls[0].data],[10,20,30,255,50,25,10,128]);
    assert.equal(source.data[0],100);
  } finally {h.restore();}
});
test('large decoded textures are uploaded in bounded strips with correct destination offsets',()=>{
  const h=harness(),gl=h.gl;
  try {
    const source={width:4096,height:2049,data:new Uint8Array(4096*2049*4)};
    source.data[0]=27;source.data[source.data.length-1]=93;
    gl.texSubImage2D(gl.TEXTURE_2D,0,3,7,gl.RGBA,gl.UNSIGNED_BYTE,source);
    assert.ok(h.calls.length>1);
    let rows=0;
    for(const call of h.calls){assert.equal(call.op,OPS.texSubImage2D);assert.equal(call.args[2],3);assert.equal(call.args[3],7+rows);assert.equal(call.data.length,call.args[5]*4096*4);assert.ok(call.data.length<=4*1024*1024);rows+=call.args[5];}
    assert.equal(rows,2049);assert.equal(h.calls[0].data[0],27);assert.equal(h.calls.at(-1).data.at(-1),93);
  } finally {h.restore();}
});
