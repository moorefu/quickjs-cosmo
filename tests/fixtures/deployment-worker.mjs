import * as os from 'os';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
os.Worker.parent.onmessage=({data})=>{
    try {
        let nested=null;
        if(data.nested) {
            const child=spawnSync(data.binary,[data.script,'--identity','worker-child'],{encoding:'utf8',timeout:15000});
            if(child.error||child.status)throw Error(child.stderr||String(child.error));
            nested=JSON.parse(child.stdout.trim().split('\n').find(v=>v.startsWith('DEPLOYMENT_RESULT ')).slice(18));
        }
        const value={execPath:process.execPath,argv0:process.argv0,argv:process.argv,pid:process.pid,legacyPid:os.getpid(),cwd:process.cwd(),zero:null,nested};
        try{const fd=fs.openSync('/dev/zero','r'),data=Buffer.alloc(32,255);value.zero={bytes:fs.readSync(fd,data,0,32,null),allZero:data.every(v=>v===0)};fs.closeSync(fd);}catch(e){value.zero={code:e.code};}
        os.Worker.parent.postMessage({value});
    }catch(error){os.Worker.parent.postMessage({error:String(error.stack)});}finally{os.Worker.parent.onmessage=null;}
};
