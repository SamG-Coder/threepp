import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('automatic instancing preserves images, fallbacks, sorting and target replacement', {
  skip:process.env.THREEBROWSER_RUN_GPU_TESTS!=='1',
},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'three-auto-instances-'));
  try {
    const outputs=[];
    for(const enabled of [false,true]) {
      const output=path.join(directory,`${enabled}.json`),trace=output+'.csv';
      const env={...process.env,THREEBROWSER_DRAW_PROFILE:trace};
      if(enabled) delete env.THREEBROWSER_DISABLE_AUTO_INSTANCING;
      else env.THREEBROWSER_DISABLE_AUTO_INSTANCING='1';
      execFileSync(process.execPath,[fileURLToPath(new URL('./automatic-instancing-fixture.mjs',import.meta.url)),output],{env,timeout:60000});
      const draws=fs.readFileSync(trace,'utf8').trim().split(/\r?\n/).slice(1).map(line=>line.split(',').map(Number));
      assert.ok(draws.length>0);
      if(enabled) assert.ok(draws.some(row=>row[3]===1024),'large runs must use the bounded instancing buffer');
      else assert.ok(draws.every(row=>row[3]===1),'control must retain ordinary draws');
      outputs.push(JSON.parse(fs.readFileSync(output,'utf8')));
    }
    assert.deepEqual(outputs[0].map(x=>x.name),outputs[1].map(x=>x.name));
    for(let i=0;i<outputs[0].length;i++) {
      const a=Buffer.from(outputs[0][i].data,'base64'),b=Buffer.from(outputs[1][i].data,'base64');
      let error=0;for(let j=0;j<a.length;j++) error+=Math.abs(a[j]-b[j]);
      assert.ok(error/a.length/255<.001,`${outputs[0][i].name}: batching changed the image`);
    }
  } finally {
    // Only delete files created inside this known, fresh test directory.
    for(const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,name));
    fs.rmdirSync(directory);
  }
});
