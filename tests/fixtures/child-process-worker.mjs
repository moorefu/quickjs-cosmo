import * as os from 'os';
import cp from 'node:child_process';
const parent=os.Worker.parent;
parent.onmessage=({data})=>{
    const windows=process.platform==='win32',shell=windows?process.env.comspec||'cmd.exe':'/bin/sh';
    const result=cp.spawnSync(shell,[...(windows?['/d','/s','/c']:['-c']),'echo worker-child'],{cwd:data,encoding:'utf8',windowsHide:true});
    parent.postMessage({text:result.stdout.trim(),status:result.status,pid:result.pid>0});
    parent.onmessage=null;
};
