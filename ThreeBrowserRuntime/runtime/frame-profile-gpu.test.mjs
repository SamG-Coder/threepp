import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('optional worker timing includes offscreen command batches and polls GPU results', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1',
}, () => {
  const output = path.join(os.tmpdir(),`three-runtime-profile-${process.pid}.json`);
  const trace = output+'.jsonl';
  try {
    execFileSync(process.execPath,[fileURLToPath(new URL('./benchmark-hotpaths.mjs',import.meta.url)),output,'10'],{
      env:{...process.env,THREEBROWSER_FRAME_PROFILE:trace},timeout:30000,
    });
    const rows = fs.readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(new Set(rows.map(row=>row.sequence)).size,rows.length);
    assert.ok(rows.every(row=>row.cpuUs>=0 && (row.gpuUs===null || row.gpuUs>=0)));
    assert.ok(rows.some(row=>row.presentsAfter>row.presentsBefore),'presentation must be identified');
    assert.ok(rows.some(row=>row.bytes>1000000 && row.presentsAfter===row.presentsBefore && row.cpuUs>0 && row.gpuUs>0),
      'GPU timing must cover offscreen batches, not just presentation');
  } finally {
    for(const file of [output,output+'.png',trace]) if(fs.existsSync(file)) fs.unlinkSync(file);
  }
});
