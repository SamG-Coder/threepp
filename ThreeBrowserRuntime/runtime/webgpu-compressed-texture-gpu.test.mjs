import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {formatNum} from '../../host/ThreeBrowser/web/three-webgpu-cmd.js';
const formats=['bc1-rgba-unorm','bc1-rgba-unorm-srgb','bc2-rgba-unorm','bc2-rgba-unorm-srgb','bc3-rgba-unorm','bc3-rgba-unorm-srgb','bc4-r-unorm','bc4-r-snorm','bc5-rg-unorm','bc5-rg-snorm','bc6h-rgb-ufloat','bc6h-rgb-float','bc7-rgba-unorm','bc7-rgba-unorm-srgb'];
test('all advertised BC formats match the native header and unknown formats fail explicitly',()=>{
 const header=fs.readFileSync(new URL('../../third_party/wgpu-native/include/webgpu/webgpu.h',import.meta.url),'utf8');
 const values=[...header.matchAll(/WGPUTextureFormat_BC\w+ = (0x[\da-fA-F]+)/g)].map(m=>Number(m[1]));
 assert.deepEqual(formats.map(formatNum),values);
 assert.throws(()=>formatNum('not-a-format'),/Unsupported WebGPU texture format/);
});
test('BC7 linear and sRGB textures decode correctly through their 2x2 and 1x1 mips', {skip:process.env.THREEBROWSER_RUN_GPU_TESTS!=='1'},async()=>{
 process.env.THREEBROWSER_RUNTIME_ADDON=fileURLToPath(new URL('../build/bin/three_browser_runtime.node',import.meta.url));
 const host=await import('./browser-host.mjs');
 host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/',import.meta.url)));
 try{
 assert.ok(host.native.webGpuStart(16,16),host.native.lastError());
 (await import('../../host/ThreeBrowser/web/three-webgpu-gpu.js')).install();
 const device=await (await navigator.gpu.requestAdapter()).requestDevice();
 // BC7 mode 6: two identical endpoints, RGB=128, alpha=254, all indices zero.
 let bits=64n,shift=7n;
 for(const v of [64,64,64,64,64,64,127,127]){bits|=BigInt(v)<<shift;shift+=7n;}
 const block=new Uint8Array(16); for(let i=0;i<16;i++)block[i]=Number((bits>>BigInt(i*8))&255n);
 for(const format of ['bc7-rgba-unorm','bc7-rgba-unorm-srgb']){
 const texture=device.createTexture({size:[4,4],format,mipLevelCount:3,usage:2|4});
 for(let mipLevel=0;mipLevel<3;mipLevel++)device.queue.writeTexture({texture,mipLevel},block,{bytesPerRow:16,rowsPerImage:1},[4,4]);
 const result=device.createTexture({size:[3,1],format:'rgba8unorm',usage:1|8});
 const module=device.createShaderModule({code:`
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var decoded:texture_storage_2d<rgba8unorm,write>;
 @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) i:vec3<u32>){textureStore(decoded,vec2<i32>(i.xy),textureLoad(source,vec2(0),i32(i.x)));}`});
 device.queue.submit([]); await new Promise(r=>setTimeout(r,100)); assert.equal(host.native.lastError(),'');
 const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
 device.queue.submit([]); await new Promise(r=>setTimeout(r,100)); assert.equal(host.native.lastError(),'');
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:result.createView()}]});
 const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(3);pass.end();
 const buffer=device.createBuffer({size:256,usage:1|8});encoder.copyTextureToBuffer({texture:result},{buffer,bytesPerRow:256},[3,1]);device.queue.submit([encoder.finish()]);
 await buffer.mapAsync(1);const pixels=new Uint8Array(buffer.getMappedRange());
 for(let i=0;i<3;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(pixels[i*4+c]-(format.endsWith('srgb')?55:128))<=1,`${format} mip ${i}: ${pixels.slice(i*4,i*4+4)}`);
 assert.equal(host.native.lastError(),'');buffer.destroy();result.destroy();texture.destroy();
 }
 }finally{host.stop();}
});
