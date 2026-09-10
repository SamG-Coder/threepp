import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
process.env.THREEBROWSER_RUNTIME_ADDON=fileURLToPath(new URL('../build/bin/three_browser_runtime.node',import.meta.url));
const host=await import('./browser-host.mjs');
const T=host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/',import.meta.url)));
const captures=[];
try {
  const renderer=new T.WebGLRenderer({antialias:false});
  host.native.setLoading(false,'Regression');
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-1.2,1.2,1.2,-1.2,.1,10);
  camera.position.z=3;scene.background=new T.Color(0x000000);
  let target=new T.WebGLRenderTarget(64,64);
  const pixels=new Uint8Array(64*64*4);
  const draw=()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);globalThis.__TN.cmd.submit();renderer.readRenderTargetPixels(target,0,0,64,64,pixels);};
  const capture=name=>{draw();captures.push({name,data:Buffer.from(pixels).toString('base64')});};
  // Detailed draw tracing begins at native frame 500. Keep a culled mesh so
  // the facade submits real passes without drawing during the warm-up.
  const warm=new T.Mesh(new T.BoxGeometry(.01,.01,.01),new T.MeshBasicMaterial());
  warm.position.x=100;scene.add(warm);
  for(let i=0;i<500;i++) draw();
  scene.remove(warm);
  const geometry=new T.BoxGeometry(.045,.045,.045);
  const material=new T.MeshBasicMaterial({color:0x80c0ff,toneMapped:false});
  const meshes=[];
  for(let i=0;i<1100;i++) {
    const mesh=new T.Mesh(geometry,material);
    mesh.position.set((i%40-19.5)*.055,(Math.floor(i/40)-13.5)*.055,0);
    scene.add(mesh);meshes.push(mesh);
  }
  capture('capacity-split');
  for(let i=0;i<meshes.length;i++) {
    meshes[i].rotation.set(i*.03,i*.02,0);
    meshes[i].scale.set(1,.5+(i%3)*.2,1);
  }
  capture('moving-nonuniform');
  material.color.set(0x20ff40);meshes[0].scale.x=-1;
  meshes[1].visible=false;meshes[2].layers.set(1);
  capture('live-state-and-mirrored-fallback');
  material.wireframe=true;capture('wireframe-fallback');material.wireframe=false;
  const shader=new T.ShaderMaterial({toneMapped:false,
    vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'void main(){gl_FragColor=vec4(0.2,0.4,1.0,1.0);}'});
  for(let i=0;i<meshes.length;i+=2) meshes[i].material=shader;
  capture('mixed-shader-fallback');
  // Exercise the retained-target lifetime failure between actual scene draws.
  for(let i=0;i<24;i++) {target.dispose();target=new T.WebGLRenderTarget(64,64);draw();}
  capture('target-replacement');
  scene.clear();
  const plane=new T.PlaneGeometry(2,2);
  const near=new T.Mesh(plane,new T.MeshBasicMaterial({color:0xff0000,transparent:true,opacity:.5,depthWrite:false,toneMapped:false}));
  const far=new T.Mesh(plane,new T.MeshBasicMaterial({color:0x0000ff,transparent:true,opacity:.5,depthWrite:false,toneMapped:false}));
  near.position.z=.5;scene.add(near);scene.add(far);
  capture('sorted-transparency');
  const offset=(32*64+32)*4;
  assert.ok(pixels[offset]>pixels[offset+2],'default sorting must draw the nearer red surface last');
  renderer.sortObjects=false;capture('insertion-transparency');
  assert.ok(pixels[offset+2]>pixels[offset],'explicit false must preserve insertion order');
  renderer.sortObjects=true;capture('restored-transparency');
  assert.ok(pixels[offset]>pixels[offset+2],'sorting can be restored on the same renderer');
  writeFileSync(process.argv[2],JSON.stringify(captures));
} finally {host.stop();}
