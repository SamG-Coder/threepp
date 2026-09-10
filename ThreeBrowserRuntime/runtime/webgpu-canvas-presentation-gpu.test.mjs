import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('native canvas presentation scales the whole backing store after resize', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1',
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
  const host = await import('./browser-host.mjs');
  host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/', import.meta.url)));
  try {
    assert.ok(host.native.webGpuStart(64, 48), host.native.lastError());
    (await import('../../host/ThreeBrowser/web/three-webgpu-gpu.js')).install();
    const device = await (await navigator.gpu.requestAdapter()).requestDevice();
    const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
    const context = canvas.getContext('webgpu');
    context.configure({device, format:'bgra8unorm'});
    for (const [width,height,ratio] of [[64,48,.85],[128,96,.5],[96,64,1.5],[64,48,.85]]) {
      globalThis.innerWidth=width; globalThis.innerHeight=height;
      canvas.width=Math.floor(width*ratio); canvas.height=Math.floor(height*ratio);
      const current=context.getCurrentTexture();
      assert.equal(current.width,Math.floor(width*ratio));
      assert.equal(current._swapchain,false);
      const encoder=device.createCommandEncoder();
      encoder.beginRenderPass({colorAttachments:[{view:current.createView(),loadOp:'clear',storeOp:'store',clearValue:[.25,.5,.75,1]}]}).end();
      // Exercise the real presentation shader into a readable display-sized
      // attachment; window swapchain images do not expose COPY_SRC usage.
      const display=device.createTexture({size:[width,height],format:'bgra8unorm',usage:1|16});
      const create=context._createTexture;
      context._createTexture=(w,h,swapchain)=>swapchain?display:create.call(context,w,h,swapchain);
      try { device.queue.submit([encoder.finish()]); }
      finally { context._createTexture=create; }
      const stride=Math.ceil(width*4/256)*256;
      const buffer=device.createBuffer({size:stride*height,usage:1|8});
      const copy=device.createCommandEncoder();
      copy.copyTextureToBuffer({texture:display},{buffer,bytesPerRow:stride},[width,height]);
      device.queue.submit([copy.finish()]); await buffer.mapAsync(1);
      const pixels=new Uint8Array(buffer.getMappedRange());
      for (const [x,y] of [[0,0],[width-1,0],[0,height-1],[width-1,height-1],[width>>1,height>>1]]) {
        const pixel=Array.from(pixels.slice(y*stride+x*4,y*stride+x*4+4));
        pixel.forEach((v,i)=>assert.ok(Math.abs(v-[191,128,64,255][i])<=1,`${width}x${height} DPR ${ratio}: ${x},${y} ${pixel}`));
      }
      buffer.destroy(); display.destroy();
      // Also submit to the real surface, past the native resize hold period.
      for (let frame=0; frame<5; frame++) {
        const surfaceEncoder=device.createCommandEncoder();
        surfaceEncoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[.25,.5,.75,1]}]}).end();
        device.queue.submit([surfaceEncoder.finish()]);
      }
      assert.equal(host.native.lastError(),'');
    }
    canvas.width=globalThis.innerWidth; canvas.height=globalThis.innerHeight;
    assert.equal(context.getCurrentTexture()._swapchain,true,'DPR 1 keeps the direct presentation path');
  } finally { host.stop(); }
});
