import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('direct OpenGL bridge renders without native scene objects and preserves live data',{
  skip:process.env.THREEBROWSER_RUN_GPU_TESTS!=='1',
},()=>{
  const env={...process.env,THREEBROWSER_RUNTIME_ADDON:process.env.THREEBROWSER_RUNTIME_ADDON||fileURLToPath(new URL('../build/bin/three_browser_runtime.node',import.meta.url))};
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('./raw-gl-fixture.mjs',import.meta.url))],{env,encoding:'utf8',timeout:30000});
  const result=JSON.parse(output.trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok,true);assert.equal(result.bridge[0],0);assert.equal(result.bridge[3],0);
});
