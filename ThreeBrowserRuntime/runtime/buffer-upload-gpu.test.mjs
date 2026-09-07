import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('multiple attribute revisions upload once per observed version across render passes', {
  skip:process.env.THREEBROWSER_RUN_GPU_TESTS!=='1',
},()=>{
  const output=path.join(os.tmpdir(),`three-upload-${process.pid}.json`), trace=output+'.csv';
  try {
    execFileSync(process.execPath,[fileURLToPath(new URL('./benchmark-instance-uploads.mjs',import.meta.url)),output,'5'],{
      env:{...process.env,THREEBROWSER_BUFFER_UPLOAD_TRACE:trace},timeout:30000,
    });
    const rows=fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(line=>line.split(',').map(Number));
    assert.ok(rows.some(([,before,after])=>after-before>1),'exercise several revisions before upload');
    const seen=new Set();
    for(const [buffer,,version] of rows) {
      const key=`${buffer}:${version}`;
      assert.ok(!seen.has(key),`buffer ${buffer} version ${version} uploaded again without another change`);
      seen.add(key);
    }
  } finally {for(const file of [output,trace]) if(fs.existsSync(file)) fs.unlinkSync(file);}
});
