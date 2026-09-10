import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

test('native maps, attenuation and instanced snapshots follow live Three.js changes', {
  skip:process.env.THREEBROWSER_RUN_GPU_TESTS!=='1',
},async()=>{
  process.env.THREEBROWSER_RUNTIME_ADDON=fileURLToPath(new URL('../build/bin/three_browser_runtime.node',import.meta.url));
  const host=await import('./browser-host.mjs');
  const T=host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/',import.meta.url)));
  try {
    const renderer=new T.WebGLRenderer({antialias:false});
    const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
    scene.background=new T.Color(0x000000);
    const geometry=new T.PlaneGeometry(2,2),material=new T.MeshBasicMaterial({color:0xffffff,toneMapped:false});
    const mesh=new T.Mesh(geometry,material);scene.add(mesh);
    const target=new T.WebGLRenderTarget(16,16), pixels=new Uint8Array(16*16*4);
    const render=()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);globalThis.__TN.cmd.submit();renderer.readRenderTargetPixels(target,0,0,16,16,pixels);return [...pixels.slice(0,4)];};
    const texture=new T.DataTexture(new Uint8Array([255,0,0,255]),1,1,T.RGBAFormat,T.UnsignedByteType);
    texture.needsUpdate=true;material.map=texture;
    assert.deepEqual(render(),[255,0,0,255],'map assigned after construction must bind on first use');
    texture.image.data.set([0,255,0,255]);texture.needsUpdate=true;
    assert.deepEqual(render(),[0,255,0,255],'texture changes must upload before the next draw');
    texture.image={width:2,height:1,data:new Uint8Array([255,0,0,255,0,0,255,255])};
    texture.wrapS=T.RepeatWrapping;texture.offset.x=.75;texture.needsUpdate=true;
    assert.deepEqual(render(),[0,0,255,255],'byte texture resize and UV state must survive rebinding');
    texture.image.data.set([0,0,255,255,255,0,0,255]);texture.needsUpdate=true;
    assert.deepEqual(render(),[255,0,0,255],'matching byte uploads must preserve repeat and offset');
    texture.image={width:1,height:1,data:new Uint8Array([0,255,0,255])};texture.needsUpdate=true;
    assert.deepEqual(render(),[0,255,0,255],'resized storage must remain usable');
    material.map=null;
    assert.deepEqual(render(),[255,255,255,255],'removing a texture must clear the native slot');
    material.map=texture;
    assert.deepEqual(render(),[0,255,0,255],'reattaching the same texture must rebind');
    material.map=null;mesh.scale.set(.5,.5,.5);
    render();
    assert.deepEqual([...pixels.slice(0,4)],[0,0,0,255],'black clear must survive the startup overlay without benchmark workarounds');

    scene.remove(mesh);
    const litMaterial=new T.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,toneMapped:false});
    const litMesh=new T.Mesh(geometry,litMaterial);scene.add(litMesh);
    const point=new T.PointLight(0xffffff,4,0,2);point.position.set(0,0,2);scene.add(point);
    const center=()=>{render();return pixels[(8*16+8)*4];};
    const physical=center();point.decay=1;const linear=center();
    assert.ok(linear>physical+10,`decay changes must affect rendering: ${physical} -> ${linear}`);
    point.distance=1;assert.equal(center(),0,'distance cutoff must update without recreating the light');
    point.distance=10;assert.ok(center()>0,'distance changes must invalidate cached light state');

    scene.remove(litMesh);scene.remove(point);
    const instances=new T.InstancedMesh(new T.PlaneGeometry(.5,.5),material,2);scene.add(instances);
    const matrix=new T.Matrix4();
    instances.instanceMatrix.array.subarray=()=>{throw new Error('per-instance view allocation');};
    instances.setMatrixAt(0,matrix.makeTranslation(-.5,0,0));instances.setMatrixAt(1,matrix.makeTranslation(.5,0,0));
    // Bulk flush may use one view; the setter must never allocate one per write.
    delete instances.instanceMatrix.array.subarray;
    render();
    assert.equal(pixels[(8*16+4)*4],255);assert.equal(pixels[(8*16+12)*4],255);assert.equal(pixels[(8*16+8)*4],0);

    // Warm the native interface cache, then mutate values and replace material
    // types. Cached interface pointers must never freeze color/map/draw state.
    scene.remove(instances);scene.add(litMesh);
    const ambient=new T.AmbientLight(0xffffff,2);scene.add(ambient);
    for(const Material of [T.MeshBasicMaterial,T.MeshLambertMaterial,T.MeshPhongMaterial,T.MeshStandardMaterial,T.MeshPhysicalMaterial]) {
      const live=new Material({color:0xff0000,toneMapped:false});litMesh.material=live;
      render();
      const pixel=()=>{render();return [...pixels.slice((8*16+5)*4,(8*16+5)*4+3)];};
      let rgb=pixel();assert.ok(rgb[0]>20&&rgb[1]===0&&rgb[2]===0,`${live.type}: initial red ${rgb}`);
      live.color.set(0x00ff00);rgb=pixel();
      assert.ok(rgb[1]>20&&rgb[0]===0&&rgb[2]===0,`${live.type}: live green ${rgb}`);
      live.wireframe=true;rgb=pixel();
      assert.deepEqual(rgb,[0,0,0],`${live.type}: live wireframe must expose the background`);
      live.wireframe=false;rgb=pixel();
      assert.ok(rgb[1]>20,`${live.type}: restoring solid draws must restore coverage`);
      live.wireframe=true;pixel();live.dispose();
      litMesh.material=live;
      assert.deepEqual(pixel(),[0,0,0],`${live.type}: reuse after disposal must restore wireframe state`);
      live.wireframe=false;live.color.set(0x0000ff);rgb=pixel();
      assert.ok(rgb[2]>20&&rgb[0]===0&&rgb[1]===0,`${live.type}: rebound material must stay live ${rgb}`);
      live.dispose();
    }
  } finally {host.stop();}
});
