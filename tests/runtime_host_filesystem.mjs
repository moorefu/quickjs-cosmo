import * as os from 'os';import {probe} from './fixtures/host-filesystem-probe.mjs';
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='--signal-child'){
    if(os.kill(Number(process.argv[3]),os.SIGUSR1)!==0)throw Error('Logical signal delivery failed');
}else{
const root=globalThis.hostFilesystemRoot??process.argv[2];
if(!root)throw Error('Missing native filesystem fixture root');
const main=await probe(root+'/main'),previous=process.cwd();
try{process.chdir(main.links[0].name);main.chdir=process.cwd();}finally{process.chdir(previous);}
const worker=new os.Worker('./fixtures/host-filesystem-worker.mjs');
const value=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host filesystem Worker timeout')),15000);worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;data.error?reject(Error(data.error)):resolve(data.value);};worker.postMessage(root+'/worker');});
let received=false;os.signal(os.SIGUSR1,()=>{received=true;});
try{
    const script=globalThis.hostFilesystemScript??process.argv[1];
    const args=script===process.execPath?['--signal-child',String(os.getpid())]:[script,'--signal-child',String(os.getpid())];
    const child=spawnSync(process.execPath,args,{stdio:'ignore',timeout:5000});
    if(child.error||child.status!==0)throw Error('Signal child failed: '+String(child.error));
    const deadline=Date.now()+3000;while(!received&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    if(!received)throw Error('Logical PID signal timeout');
}finally{os.signal(os.SIGUSR1,null);}
console.log('HOST_FILESYSTEM_RESULT '+JSON.stringify({main,worker:value,platform:process.platform,signalRoundTrip:received}));
}
