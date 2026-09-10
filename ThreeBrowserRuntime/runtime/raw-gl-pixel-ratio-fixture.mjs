import assert from 'node:assert/strict';
import * as T from '../node_modules/three/build/three.module.js';
import * as host from './browser-host.mjs';
import {createRawGLRenderer} from './raw-gl.mjs';
const renderer=createRawGLRenderer(T,host,64);
try {
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
  const red=new T.Mesh(new T.PlaneGeometry(1,2),new T.MeshBasicMaterial({color:0xff0000,toneMapped:false}));red.position.x=-.5;scene.add(red);
  const green=new T.Mesh(new T.PlaneGeometry(1,2),new T.MeshBasicMaterial({color:0x00ff00,toneMapped:false}));green.position.x=.5;scene.add(green);
  for(const ratio of [1,2,.75]){
    renderer.setPixelRatio(ratio);renderer.setSize(64,64);
    renderer.render(scene,camera);
    const image=host.native.decodeImage(host.native.rendererCapturePng(64,64));
    const sample=x=>[...image.pixels.slice((32*64+x)*4,(32*64+x)*4+3)];
    assert.deepEqual(sample(16),[255,0,0],`left half at pixel ratio ${ratio}`);
    assert.deepEqual(sample(48),[0,255,0],`right half at pixel ratio ${ratio}`);
  }
  await new Promise(resolve=>setTimeout(resolve,550));
  renderer.render(scene,camera);
  assert.ok(host.native.stats().fps>0,'DirectGL publishes FPS statistics');
  assert.ok(host.native.stats().frameUs>0,'DirectGL publishes frame duration');
  console.log('pixel ratios preserve the complete camera view');
}finally{renderer.dispose();host.stop();}
