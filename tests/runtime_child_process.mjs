import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as std from 'std';
const windows=process.platform==='win32';
const shell=windows?process.env.comspec||'cmd.exe':'/bin/sh';
const prefix=windows?['/d','/s','/c']:['-c'];
assert.equal(cp.execSync('echo runtime-child',{encoding:'utf8',windowsHide:true}).trim(),'runtime-child');
assert.equal(cp.execFileSync(shell,[...prefix,'echo direct-child'],{encoding:'utf8',windowsHide:true}).trim(),'direct-child');
const failed=cp.spawnSync(shell,[...prefix,windows?'exit /b 7':'exit 7'],{windowsHide:true});
assert.equal(failed.status,7);assert.equal(failed.signal,null);assert(failed.pid>0);
const root=fs.mkdtempSync(path.join(process.cwd(),'.child-runtime-'));
try {
    const env={...process.env,CHILD_RUNTIME_TOKEN:'worker-value'};
    const command=windows?'echo %CHILD_RUNTIME_TOKEN%':'printf "%s" "$CHILD_RUNTIME_TOKEN"';
    assert.equal(cp.execFileSync(shell,[...prefix,command],{env,cwd:root,encoding:'utf8',windowsHide:true}).trim(),'worker-value');
    const worker=new os.Worker('./fixtures/child-process-worker.mjs');
    const timer=os.setTimeout(()=>std.exit(1),10000);
    try {
        const response=await new Promise(resolve=>{worker.onmessage=({data})=>resolve(data);worker.postMessage(root);});
        assert.equal(response.text,'worker-child');assert.equal(response.status,0);assert(response.pid);
    } finally {worker.onmessage=null;os.clearTimeout(timer);}
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS runtime-child-process');
