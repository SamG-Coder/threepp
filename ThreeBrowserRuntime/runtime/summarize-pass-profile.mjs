// node runtime/summarize-pass-profile.mjs trace.csv [lastPasses=5000]
import fs from 'node:fs';
const [path,count='5000']=process.argv.slice(2);
if(!path) throw new Error('Provide a THREEBROWSER_PASS_PROFILE CSV file');
const rows=fs.readFileSync(path,'utf8').trim().split('\n').slice(1)
  .map(line=>line.split(',').map(Number)).filter(row=>row.length===12 && row.every(Number.isFinite)).slice(-Number(count));
const names=['transforms','renderList','shadows','lights','draw','resolve'];
const groups=new Map(),totals=Array(6).fill(0);
for(const row of rows) {
  const key=row.slice(1,6).join('/');
  const group=groups.get(key)||{scene:row[1],camera:row[2],targetTexture:row[3],width:row[4],height:row[5],calls:0,stages:Array(6).fill(0)};
  group.calls++;
  for(let i=0;i<6;i++){group.stages[i]+=row[i+6];totals[i]+=row[i+6];}
  groups.set(key,group);
}
console.log(JSON.stringify({passes:rows.length,cpuTotalMs:Object.fromEntries(names.map((name,i)=>[name,totals[i]/1000])),
  groups:[...groups.values()].sort((a,b)=>b.stages.reduce((x,y)=>x+y,0)-a.stages.reduce((x,y)=>x+y,0)).map(group=>({
    ...group,stages:undefined,meanCpuMs:Object.fromEntries(names.map((name,i)=>[name,group.stages[i]/group.calls/1000]))
  }))},null,2));
