import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {check,result} from './fixtures/result.mjs';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE||process.execPath;
const fixture=path.resolve(path.dirname(process.argv[1]),'fixtures/child.mjs');
const data=Buffer.alloc(1024*1024,7);
const full=spawnSync(executable,[fixture,'flood'],{input:data,maxBuffer:4*1024*1024,windowsHide:true});
check(!full.error&&full.status===0,'large duplex child succeeds');
check(full.stdout.subarray(0,1024*1024).every(x=>x===97),'stdout content');
check(full.stderr.every(x=>x===98)&&full.stderr.length===1024*1024,'stderr content');
check(full.stdout.subarray(1024*1024).toString()==='INPUT=1048576','stdin fully delivered');
const overflow=spawnSync(executable,[fixture,'flood'],{maxBuffer:100,windowsHide:true});
check(overflow.error?.code==='ENOBUFS','aggregate output cap');
const timeout=spawnSync(executable,[fixture,'sleep'],{timeout:100,windowsHide:true});
check(timeout.error?.code==='ETIMEDOUT','timeout');
const killed=spawnSync(executable,[fixture,'sleep'],{timeout:100,killSignal:'SIGKILL',windowsHide:true});
const unlimited=spawnSync(executable,[fixture,'input'],{input:data,maxBuffer:0,windowsHide:true});
check(unlimited.stdout.equals(data),'maxBuffer zero means unlimited');
result({full:{out:full.stdout.length,err:full.stderr.length,status:full.status,signal:full.signal},
    overflow:{code:overflow.error.code,errno:overflow.error.errno,pid:overflow.pid>0,nonempty:overflow.stdout.length>100},
    timeout:{code:timeout.error.code,errno:timeout.error.errno,status:timeout.status,signal:timeout.signal},
    killed:{code:killed.error.code,status:killed.status,signal:killed.signal},unlimited:unlimited.stdout.length});
