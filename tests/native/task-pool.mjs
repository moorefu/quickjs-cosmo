import a from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as os from 'os';
const input=Uint8Array.of(1,2,3,4);
a.throws(()=>nativeTask(0,new ArrayBuffer(70000)));
let ticks=0;
const timer=setInterval(()=>ticks++,5);
const first=nativeTask(150,input.buffer);
input.fill(99);detachInput(input.buffer);
const value=await first.promise;
clearInterval(timer);
a.equal(value.sum,10);a(value.background);a(ticks>=3,'timers advance during native work');
a.equal(taskStats().active,0);
const trace=[];
await Promise.all([nativeTask(0).promise.then(()=>{trace.push('done');process.nextTick(()=>trace.push('tick'));Promise.resolve().then(()=>trace.push('micro'));}),
    nativeTask(60).promise.then(()=>trace.push('later'))]);
a.equal(JSON.stringify(trace),JSON.stringify(['done','micro','tick','later']));
const jobs=Array.from({length:64},()=>nativeTask(1000));
a.equal(taskStats().active,64);a.equal(taskStats().workers,2);
a.throws(()=>nativeTask(0),{code:'ERR_TASK_QUEUE_FULL'});
const cancelled=Promise.all(jobs.map(job=>job.promise.catch(error=>{a.equal(error.code,'ABORT_ERR');return 1;})));
for(const job of jobs){a(cancelTask(job.id));a.equal(cancelTask(job.id),false);}
a.equal((await cancelled).length,64);a.equal(taskStats().active,0);a.equal(taskStats().reserved,0);
a.equal(cancelTask(first.id),false);
const large=[nativeTask(0,undefined,32*1024*1024),nativeTask(0,undefined,32*1024*1024)];
a.throws(()=>nativeTask(0),{code:'ERR_TASK_MEMORY_LIMIT'});
await Promise.all(large.map(x=>x.promise));a.equal(taskStats().reserved,0);
const root=fs.mkdtempSync(path.join(process.cwd(),'.task-worker-'));
try {
    const file=path.join(root,'worker.mjs');
    fs.writeFileSync(file,"import * as os from 'os';const t=nativeTask(50,Uint8Array.of(5,6).buffer);const result=await t.promise;os.Worker.parent.postMessage(result);\n");
    // The legacy os.Worker accepts Cosmopolitan's /D/... host spelling.
    // Native drive-letter realpath is an existing entry-path issue tracked
    // for M6; it must not obscure native task ownership in this fixture.
    const workerPath=process.platform==='win32'?file.replace(/\\/g,'/').replace(/^([A-Za-z]):/,'/$1'):file;
    const worker=new os.Worker(workerPath);
    const result=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('task Worker did not complete')),10000);
        worker.onmessage=({data})=>{clearTimeout(timeout);worker.onmessage=null;resolve(data);};
    });
    a.equal(result.sum,11);a(result.background);
} finally {fs.rmSync(root,{recursive:true,force:true});}
globalThis.taskFixturePassed=true;
