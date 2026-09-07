// Controlled runtime benchmark; does not load or modify application code.
// node runtime/benchmark-hotpaths.mjs output.json [frames=200]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
const host = await import('./browser-host.mjs');
const T = host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/', import.meta.url)));
const output = process.argv[2];
if (!output) throw new Error('Provide an output JSON path');
const frames = Number(process.argv[3] || 200);
const times = [], digest = createHash('sha256');
try {
  const renderer = new T.WebGLRenderer({ antialias: true });
  const scene = new T.Scene(), camera = new T.OrthographicCamera(-1,1,1,-1,.1,10);
  camera.position.z = 2;
  const data = new Float32Array(256 * 256 * 4);
  const texture = new T.DataTexture(data,256,256,T.RGBAFormat,T.FloatType);
  texture.needsUpdate = true;
  const material = new T.ShaderMaterial({
    uniforms: { source: { value: texture } },
    vertexShader: 'varying vec2 texUV;void main(){texUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform sampler2D source;varying vec2 texUV;void main(){gl_FragColor=texture2D(source,texUV);}',
  });
  scene.add(new T.Mesh(new T.PlaneGeometry(2,2),material));
  // Many ordinary transform-only objects exercise repeated preparation without
  // changing draw count or shader cost between versions.
  for(let i=0;i<1000;i++) { const object = new T.Object3D(); object.position.x=i/1000; scene.add(object); }
  const target = new T.WebGLRenderTarget(128,128,{samples:4});
  const pixels = new Uint8Array(128*128*4);
  for(let frame=-30;frame<frames;frame++) {
    const value = (Math.max(frame,0)%16)/15;
    for(let p=0;p<data.length;p+=4) { data[p]=value; data[p+1]=.25; data[p+2]=.75; data[p+3]=1; }
    const start=performance.now();
    texture.needsUpdate=true;
    renderer.setRenderTarget(target);
    for(let pass=0;pass<8;pass++) renderer.render(scene,camera);
    globalThis.__TN.cmd.submit();
    renderer.readRenderTargetPixels(target,0,0,128,128,pixels);
    if(frame>=0) {
      times.push(performance.now()-start); digest.update(pixels);
      for(const [channel,expected] of [value*255,63.75,191.25,255].entries())
        assert.ok(Math.abs(pixels[channel]-expected)<=1, `frame ${frame} channel ${channel}: ${pixels[channel]} vs ${expected}`);
    }
  }
  renderer.setRenderTarget(null); renderer.render(scene,camera); globalThis.__TN.cmd.submit();
  fs.writeFileSync(output+'.png',host.native.rendererCapturePng(1280,720));
  const result = { workload: 'float256-8passes-msaa4-1000objects-v1', frames,
    medianMs:[...times].sort((a,b)=>a-b)[Math.floor(times.length/2)],
    p95Ms:[...times].sort((a,b)=>a-b)[Math.floor(times.length*.95)],
    meanMs:times.reduce((a,b)=>a+b,0)/times.length, pixelHash:digest.digest('hex'), times,
    stats:host.native.stats() };
  fs.writeFileSync(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,times:undefined}));
} finally { host.stop(); }
