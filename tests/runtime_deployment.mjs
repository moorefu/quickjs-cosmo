import fs from 'node:fs';
import cp from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as os from 'os';
const deepEqual=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);
const identity=()=>({execPath:process.execPath,argv0:process.argv0,argv:process.argv,pid:process.pid,ppid:process.ppid,legacyPid:os.getpid(),cwd:process.cwd(),
    native:globalThis.deploymentNative??null,protocol:Object.keys(process.env).filter(k=>/^_COSMO_FDS(?:_V2)?$/.test(k))});
const workerInfo=data=>new Promise((resolve,reject)=>{
    const worker=new os.Worker('./fixtures/deployment-worker.mjs'),timer=setTimeout(()=>reject(Error('deployment Worker timeout')),20000);
    worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;data.error?reject(Error(data.error)):resolve(data.value);};worker.postMessage(data);
});
const kernel=process.env.QJS_KERNEL64K==='1';
if(process.argv.includes('--signal')) {
    assert.equal(os.kill(Number(process.argv.at(-1)),os.SIGUSR1),0);
}else if(process.argv.includes('--identity')) {
    console.log('DEPLOYMENT_RESULT '+JSON.stringify(identity()));
}else if(process.env.QJS_DEPLOY_CUSTOM_ONLY) {
    const main=identity(),worker=await workerInfo({nested:false});
    assert.equal(worker.argv0,main.argv0);assert.equal(worker.execPath,main.execPath);assert.equal(worker.pid,main.pid);
    console.log('DEPLOYMENT_RESULT '+JSON.stringify({main,worker,custom:true}));
}else if(process.env.QJS_DEPLOY_SECURITY) {
    const worker=await workerInfo({nested:false}),qjs=process.env.QJS_DEPLOY_QJS,script=process.env.QJS_DEPLOY_SCRIPT;
    let received=false;os.signal(os.SIGUSR1,()=>{received=true;});
    try {
        const child=cp.spawnSync(qjs,['-m',script,'--signal',String(os.getpid())],{timeout:10000,encoding:'utf8',windowsHide:true});
        assert.equal(child.status,0,child.stderr);
        const deadline=Date.now()+5000;while(!received&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
        assert(received,'Restricted signal delivery timed out');
    }finally{os.signal(os.SIGUSR1,null);}
    const file=path.join(process.env.TMP,'security-write');fs.writeFileSync(file,'allowed');assert.equal(fs.readFileSync(file,'utf8'),'allowed');
    console.log('DEPLOYMENT_SECURITY '+JSON.stringify({main:identity(),worker,child:true,signalRoundTrip:received}));
}else if(kernel) {
    const expected=JSON.parse(fs.readFileSync('/app/immutable.json','utf8'));
    const immutable=()=>{for(const [file,digest] of Object.entries(expected))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,'Guest master changed: '+file);};
    immutable();
    const main=identity(),worker=await workerInfo({nested:true,binary:'/app/qjs.exe',script:'/app/kernel.mjs'});
    assert.equal(worker.execPath,main.execPath);assert.equal(worker.pid,main.pid);assert(worker.nested.pid>0);
    if(main.native){assert.equal(main.native.pageSize,65536);assert.equal(main.native.auxPageSize,65536);}
    const nested=cp.spawnSync('/app/qjs.exe',['/app/kernel.mjs','--identity','nested'],{encoding:'utf8',timeout:15000,argv0:'nested-custom'});
    assert.equal(nested.status,0,nested.stderr);assert.equal(JSON.parse(nested.stdout.slice(18)).argv0,'nested-custom');
    immutable();console.log('DEPLOYMENT_RESULT '+JSON.stringify({main,worker,kernel:true,immutable:true}));
}else {
    const root=process.env.QJS_DEPLOY_ROOT,child=process.env.QJS_DEPLOY_CHILD,qjs=process.env.QJS_DEPLOY_QJS,node=process.env.QJS_DEPLOY_NODE;
    assert(root&&child&&qjs&&node,'Missing deployment harness inputs');
    const before=process.env._COSMO_FDS,results=[],alphabet=['a',' ','\\','"','中','\t'],vectors=['','trailing\\','a\\\\\\"b\\'];
    let level=[''];for(let length=1;length<=3;length++){level=level.flatMap(v=>alphabet.map(c=>v+c));vectors.push(...level);}
    const asyncRun=(binary,args,options)=>new Promise((resolve,reject)=>{
        const process=cp.spawn(binary,args,options),out=[],err=[];
        const timer=setTimeout(()=>{process.kill();reject(Error('deployment child timeout'));},15000);
        process.on('error',error=>{clearTimeout(timer);reject(error);});
        process.stdout?.on('data',v=>out.push(v));process.stderr?.on('data',v=>err.push(v));
        process.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()});});
    });
    for(const [target,binary] of [['ape',qjs],['native',node]]) {
        for(let start=0;start<vectors.length;start+=32) {
            const args=vectors.slice(start,start+32),prefix=[child,'args'],options={encoding:'utf8',windowsHide:true,timeout:15000,argv0:'caller argv0 中文'};
            for(const [api,run] of [['sync',()=>cp.spawnSync(binary,[...prefix,...args],options)],['async',()=>asyncRun(binary,[...prefix,...args],options)]]) {
                const response=await run();assert.equal(response.status,0,response.stderr);const value=JSON.parse(response.stdout);
                deepEqual(value.args,args);assert.equal(value.argv0,options.argv0);deepEqual(value.protocol,[]);
                assert.equal(fs.realpathSync(value.execPath),fs.realpathSync(binary));
                results.push({target,api,count:args.length});
            }
            const file=path.join(root,'legacy.json'),fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);
            assert(fd>=0);let status;
            try{status=os.exec(['legacy argv0 中文',...prefix,...args],{file:binary,block:true,usePath:false,stdout:fd});}finally{os.close(fd);}
            assert.equal(status,0);const legacy=JSON.parse(fs.readFileSync(file,'utf8'));
            deepEqual(legacy.args,args);deepEqual(legacy.protocol,[]);
            // Legacy Windows exec retains its own documented path conversion policy.
            assert.equal(legacy.argv0,'legacy argv0 中文');results.push({target,api:'legacy',count:args.length});
        }
        for(const api of ['sync','async','legacy','legacy-async']) {
            const file=path.join(root,'cursor'),errorFile=path.join(root,'cursor-error');fs.writeFileSync(file,'0123456789');
            const fd=fs.openSync(file,'r+');const prefix=Buffer.alloc(3);assert.equal(fs.readSync(fd,prefix,0,3,null),3);
            let response,status,err;
            try {
                if(api.startsWith('legacy')) {
                    const stderr=os.open(errorFile,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);assert(stderr>=0);
                    try{
                        status=os.exec([binary,child,'cursor'],{file:binary,block:api==='legacy',usePath:false,stdin:fd,stdout:fd,stderr});
                        if(api==='legacy-async'){
                            const waited=os.waitpid(status,0);assert.equal(waited[0],status);status=waited[1];
                        }
                    }finally{os.close(stderr);}
                    err=fs.readFileSync(errorFile,'utf8');
                }else {
                    const options={stdio:[fd,fd,'pipe'],encoding:'utf8',windowsHide:true,timeout:15000};
                    response=api==='sync'?cp.spawnSync(binary,[child,'cursor'],options):await asyncRun(binary,[child,'cursor'],options);status=response.status;err=String(response.stderr);
                }
                assert.equal(status,0,err);deepEqual(JSON.parse(err),{count:3,input:'345',protocol:[]},target+'/'+api+' inherited cursor');
                const tail=Buffer.alloc(2);assert.equal(fs.readSync(fd,tail,0,2,null),2);assert.equal(tail.toString(),'89',target+'/'+api+' parent cursor');
            }finally{fs.closeSync(fd);}
            assert.equal(fs.readFileSync(file,'utf8'),'012345XY89');results.push({target,api,sharedCursor:true});
        }
    }
    const launcher=process.env.QJS_DEPLOY_NATIVE_LAUNCHER;
    const fromNative=cp.spawnSync(node,[child,'launch',launcher||qjs,JSON.stringify([...(launcher?['-',qjs,'native-to-APE 中文']:[]),child,'args']),'','\\','"','中文'],{encoding:'utf8',timeout:20000,windowsHide:true});
    assert.equal(fromNative.status,0,fromNative.stderr);deepEqual(JSON.parse(fromNative.stdout).args,['','\\','"','中文']);
    const main=identity(),worker=await workerInfo({nested:true,binary:qjs,script:process.env.QJS_DEPLOY_SCRIPT});
    assert.equal(worker.execPath,main.execPath);assert.equal(worker.argv0,main.argv0);assert.equal(worker.pid,main.pid);
    assert.equal(process.env._COSMO_FDS,before);deepEqual(main.protocol,[]);
    console.log('DEPLOYMENT_RESULT '+JSON.stringify({main,worker,results,vectors:vectors.length,nativeToApe:true}));
}
