import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [mode,...args]=process.argv.slice(2);
if(mode==='cursor') {
    const input=Buffer.alloc(3);const count=fs.readSync(0,input,0,3,null);
    fs.writeSync(1,Buffer.from('XY'));
    fs.writeSync(2,JSON.stringify({count,input:input.toString(),protocol:Object.keys(process.env).filter(k=>/^_COSMO_FDS(?:_V2)?$/.test(k))}));
} else if(mode==='launch') {
    const [binary,encoded,...values]=args;
    const child=spawnSync(binary,[...JSON.parse(encoded),...values],{argv0:'native-to-APE 中文',encoding:'utf8',timeout:15000,windowsHide:true});
    if(child.error||child.status!==0)throw Error('native-to-APE failed '+JSON.stringify({error:String(child.error),status:child.status,stderr:child.stderr}));
    fs.writeSync(1,child.stdout);
} else {
    fs.writeSync(1,JSON.stringify({args,argv0:process.argv0,execPath:process.execPath,argv:process.argv,pid:process.pid,ppid:process.ppid,cwd:process.cwd(),
        protocol:Object.keys(process.env).filter(k=>/^_COSMO_FDS(?:_V2)?$/.test(k))}));
}
