// Fixed multi-pass workload with many writes before each draw. No application source.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node',import.meta.url));
const host = await import('./browser-host.mjs');
const T = host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/',import.meta.url)));
const output = process.argv[2], frames = Number(process.argv[3] || 200);
assert.ok(output && Number.isInteger(frames) && frames > 0);
try {
  const renderer = new T.WebGLRenderer(), scene = new T.Scene();
  const camera = new T.OrthographicCamera(-1,1,1,-1,.1,10); camera.position.z=2;
  const mesh = new T.InstancedMesh(new T.PlaneGeometry(.08,.08),new T.MeshBasicMaterial({color:0xffffff}),256);
  scene.add(mesh);
  const matrix = new T.Matrix4(), target = new T.WebGLRenderTarget(128,128,{samples:4});
  const pixels = new Uint8Array(128*128*4), hash=createHash('sha256'), times=[];
  renderer.setRenderTarget(target);
  for(let frame=-30;frame<frames;frame++) {
    const start=performance.now();
    for(let j=0;j<256;j++) {
      const index=(j%2)*128+Math.floor(j/2);
      matrix.makeTranslation((index%16)/8-.94+(frame%2)*.01,Math.floor(index/16)/8-.94,0);
      mesh.setMatrixAt(index,matrix);
    }
    for(let pass=0;pass<8;pass++) renderer.render(scene,camera);
    globalThis.__TN.cmd.submit();
    renderer.readRenderTargetPixels(target,0,0,128,128,pixels);
    if(frame>=0) {times.push(performance.now()-start);hash.update(pixels);}
  }
  assert.ok(pixels.some((value,index)=>index%4===0 && value>0),'instances must be rendered');
  times.sort((a,b)=>a-b);
  const result={workload:'256-instance-writes-8passes-v1',frames,medianMs:times[Math.floor(times.length/2)],
    p95Ms:times[Math.floor(times.length*.95)],meanMs:times.reduce((a,b)=>a+b,0)/times.length,pixelHash:hash.digest('hex')};
  fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {host.stop();}
