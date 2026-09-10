import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('native ray queries see odd and even instance groups after mask updates', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1',
}, async t => {
  process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
  const host = await import('./browser-host.mjs');
  host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/', import.meta.url)));
  try {
    assert.ok(host.native.webGpuStart(16,16), host.native.lastError());
    (await import('../../host/ThreeBrowser/web/three-webgpu-gpu.js')).install();
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const rtx = navigator.gpu.threeBrowserRTX;
    if (!rtx?.capabilities?.nativeRayTracing) { t.skip('Hardware ray queries unavailable'); return; }
    const pipeline = rtx.compileRayQueryPipeline({profile:'lighting-v1',language:'glsl',stage:'compute',entryPoint:'main',label:'Instance visibility regression',source:`#version 460
#extension GL_EXT_ray_query : require
layout(local_size_x=8,local_size_y=8) in;
layout(set=0,binding=0) uniform accelerationStructureEXT scene;
layout(rgba16f,set=0,binding=1) uniform image2D color;
layout(set=0,binding=2) uniform sampler2D depth;
void main() {
 if (any(greaterThan(gl_GlobalInvocationID.xy,uvec2(0)))) return;
 rayQueryEXT q;
 rayQueryInitializeEXT(q,scene,gl_RayFlagsOpaqueEXT,255u,vec3(0,0,1),0.01,vec3(0,0,-1),10.0);
 while(rayQueryProceedEXT(q)) {}
 bool hit=rayQueryGetIntersectionTypeEXT(q,true)!=gl_RayQueryCommittedIntersectionNoneEXT;
 imageStore(color,ivec2(0),hit?vec4(1,0,0,1):vec4(0,1,0,1));
}`});
    const color = device.createTexture({size:[1,1],format:'rgba16float',usage:1|4|8|16});
    const depth = device.createTexture({size:[1,1],format:'depth32float',usage:4|16});
    const clear = device.createCommandEncoder();
    clear.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}}).end();
    device.queue.submit([clear.finish()]);
    const identity=[1,0,0,0,0,1,0,0,0,0,1,0];
    const inverse=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const resource=(texture,layout)=>({texture,layout,width:1,height:1});
    const read = async () => {
      const encoder=device.createCommandEncoder();
      rtx.evaluateRayLighting({pipeline,commandEncoder:encoder,color:resource(color,rtx.vulkanImageLayouts.colorAttachment),depth:resource(depth,rtx.vulkanImageLayouts.depthStencilAttachment),width:1,height:1,inverseViewProjection:inverse,cameraPosition:[0,0,1],directionalLightDirection:[0,0,1]});
      device.queue.submit([encoder.finish()]);
      const buffer=device.createBuffer({size:256,usage:1|8});
      const copy=device.createCommandEncoder();
      copy.copyTextureToBuffer({texture:color},{buffer,bytesPerRow:256},[1,1]);
      device.queue.submit([copy.finish()]);
      await buffer.mapAsync(1);
      const result=Array.from(new Uint16Array(buffer.getMappedRange().slice(0,8)));
      buffer.destroy();
      return result;
    };
    for (const capacity of [1,2,3]) {
      rtx.registerStaticScene({positions:new Float32Array([-1,-100,-1,1,-100,-1,0,-100,1]),indices:new Uint32Array([0,1,2]),instanceGroups:[{id:1,capacity,positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),indices:new Uint32Array([0,1,2])}]});
      const matrices=new Float32Array(capacity*12);
      for(let i=0;i<capacity;i++) matrices.set(identity,i*12);
      const masks=new Uint32Array(capacity);
      masks[capacity-1]=255;
      rtx.updateInstanceGroup({id:1,matrices,masks});
      assert.doesNotMatch(host.native.lastError(),/malformed RTX instance-group update/);
      assert.deepEqual(await read(),[15360,0,0,15360],`${capacity} slots must produce a real triangle hit`);
      masks.fill(0); rtx.updateInstanceGroup({id:1,matrices,masks});
      assert.deepEqual(await read(),[0,15360,0,15360],`${capacity} slots must become invisible after masking`);
    }
    rtx.destroyStaticScene(); pipeline.destroy(); color.destroy(); depth.destroy();
  } finally { host.stop(); }
});
