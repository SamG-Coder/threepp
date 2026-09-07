// node runtime/summarize-frame-profile.mjs trace.jsonl [warmupPresentations=60] [lastPresentation]
import fs from 'node:fs';
const [path, warmup = '60', last = 'Infinity'] = process.argv.slice(2);
if (!path) throw new Error('Provide a THREEBROWSER_FRAME_PROFILE JSONL file');
const rows = fs.readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).sort((a,b)=>a.sequence-b.sequence);
const frames = [];
let frame = {cpuUs:0,gpuUs:0,gpuMissing:0,bytes:0,batches:0};
for(const row of rows) {
  frame.cpuUs += row.cpuUs; frame.bytes += row.bytes; frame.batches++;
  if(row.gpuUs === null) frame.gpuMissing++; else frame.gpuUs += row.gpuUs;
  if(row.presentsAfter > row.presentsBefore) {
    if(row.presentsAfter > Number(warmup) && row.presentsAfter <= Number(last)) frames.push({...frame,presentation:row.presentsAfter});
    frame = {cpuUs:0,gpuUs:0,gpuMissing:0,bytes:0,batches:0};
  }
}
const summarize = values => {
  if(!values.length) return null;
  values.sort((a,b)=>a-b);
  return {mean:values.reduce((a,b)=>a+b,0)/values.length,median:values[Math.floor(values.length/2)],p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]};
};
console.log(JSON.stringify({frames:frames.length,completeGpuFrames:frames.filter(f=>!f.gpuMissing).length,
  cpuSubmissionMs:summarize(frames.map(f=>f.cpuUs/1000)),
  gpuSubmissionSpanMs:summarize(frames.filter(f=>!f.gpuMissing).map(f=>f.gpuUs/1000)),
  batches:summarize(frames.map(f=>f.batches)),bytes:summarize(frames.map(f=>f.bytes)),
  unpresentedBatches:frame.batches},null,2));
