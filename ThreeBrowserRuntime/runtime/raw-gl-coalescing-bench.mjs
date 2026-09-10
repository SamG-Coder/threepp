// Synthetic producer-overwrite case: four updates of 10,000 instance matrices
// before the consumer reads the buffer. This is not a stock Three.js scene score.
import assert from 'node:assert/strict';
import * as T from '../node_modules/three/build/three.module.js';
import * as host from './browser-host.mjs';
import {createRawGLRenderer} from './raw-gl.mjs';

const renderer=createRawGLRenderer(T,host,32),gl=renderer.getContext();
const updates=Array.from({length:4},(_,i)=>new Float32Array(10000*16).fill(i+1));
const output=new Float32Array(updates[0].length),buffer=gl.createBuffer();
try {
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,output.byteLength,gl.DYNAMIC_DRAW);
  const run=()=>{
    for(const update of updates) gl.bufferSubData(gl.ARRAY_BUFFER,0,update);
    gl.getBufferSubData(gl.ARRAY_BUFFER,0,output);
  };
  for(let i=0;i<30;i++)run();
  const before=gl.getBridgeStats(),beforeCommands=gl.getCommandStats(),samples=[];
  for(let i=0;i<360;i++) {
    const start=performance.now();run();samples.push(performance.now()-start);
  }
  assert.ok(output.every(value=>value===4),'readback must observe the last update');
  const after=gl.getBridgeStats(),afterCommands=gl.getCommandStats();
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({
    workload:'four 640,000-byte instance-buffer updates then synchronous full readback',
    coalescing:process.env.THREEBROWSER_DISABLE_RAW_GL_COALESCING!=='1',
    samples:360,medianMs:samples[180],p95Ms:samples[Math.ceil(360*.95)-1],p99Ms:samples[Math.ceil(360*.99)-1],
    nativeCommands:after[1]-before[1],
    uploadsCoalesced:afterCommands.bufferUploadsCoalesced-beforeCommands.bufferUploadsCoalesced,
    commandBytesSaved:afterCommands.bytesSkipped-beforeCommands.bytesSkipped,
    readbackValid:true
  }));
} finally {gl.deleteBuffer(buffer);renderer.dispose();host.stop();}
