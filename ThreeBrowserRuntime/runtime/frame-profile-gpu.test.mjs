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
  const passes = output+'.csv';
  try {
    execFileSync(process.execPath,[fileURLToPath(new URL('./benchmark-hotpaths.mjs',import.meta.url)),output,'10'],{
      env:{...process.env,THREEBROWSER_FRAME_PROFILE:trace,THREEBROWSER_PASS_PROFILE:passes},timeout:30000,
    });
    const rows = fs.readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(new Set(rows.map(row=>row.sequence)).size,rows.length);
    assert.ok(rows.every(row=>row.cpuUs>=0 && (row.gpuUs===null || row.gpuUs>=0)));
    assert.ok(rows.some(row=>row.presentsAfter>row.presentsBefore),'presentation must be identified');
    assert.ok(rows.some(row=>row.bytes>1000000 && row.presentsAfter===row.presentsBefore && row.cpuUs>0 && row.gpuUs>0),
      'GPU timing must cover offscreen batches, not just presentation');
    const passRows = fs.readFileSync(passes,'utf8').trim().split(/\r?\n/);
    assert.equal(passRows.shift(),'pass,scene,camera,target,width,height,transformsUs,listUs,shadowsUs,lightsUs,drawUs,resolveUs');
    const stages = passRows.map(line=>line.split(',').map(Number));
    assert.ok(stages.length >= 8*40, 'every offscreen render pass must be measured');
    assert.ok(stages.every(row=>row.length===12 && row.every(value=>Number.isFinite(value) && value>=0)));
    assert.ok(stages.some(row=>row[4]===128 && row[5]===128 && row[10]>0));
  } finally {
    for(const file of [output,output+'.png',trace,passes]) if(fs.existsSync(file)) fs.unlinkSync(file);
  }
});
