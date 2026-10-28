import cp from 'node:child_process';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import {createHash,hkdf} from 'node:crypto';
import {promisify} from 'node:util';
import path from 'node:path';
import {result,check} from './fixtures/result.mjs';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE||process.execPath,fixture=path.resolve(path.dirname(process.argv[1]),'fixtures/child.mjs'),base={windowsHide:true},output={};
const spawn=mode=>cp.spawn(executable,[fixture,mode],base);
const close=child=>new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve([code,signal]));});
{
    const child=spawn('flood'),done=close(child),parts=[[],[]],callbackErrors=[];let ticks=0,paused=false,callbacks=0,inputError=null;
    child.stdin.on('error',error=>inputError=error.code);
    const timer=setInterval(()=>ticks++,1);
    child.stdout.on('data',chunk=>{parts[0].push(chunk);if(!paused){paused=true;child.stdout.pause();setTimeout(()=>child.stdout.resume(),5);}});child.stderr.on('data',chunk=>parts[1].push(chunk));
    const refs=[child.stdin,child.stdout,child.stderr].map(s=>{const u=s.unref(),r=s.ref();return [u===s,r===s];});
    const input=Buffer.alloc(1024*1024,99),backpressure=child.stdin.write(input,error=>{callbacks++;if(error)callbackErrors.push(error.code);});child.stdin.end(error=>{callbacks++;if(error)callbackErrors.push(error.code);});
    const status=await done;clearInterval(timer);const data=parts.map(chunks=>Buffer.concat(chunks));if(inputError)console.error('flood child: '+JSON.stringify({status,inputError,stderr:data[1].toString()}));check(!inputError,'flood stdin succeeds');
    output.flood={status,lengths:data.map(x=>x.length),digests:data.map(x=>createHash('sha256').update(x).digest('hex')),backpressure,callbacks,callbackErrors,progress:ticks>0,refs};
}
{
    const child=spawn('input'),done=close(child),parts=[];
    await Promise.all([pipeline(Readable.from([Buffer.alloc(150000,17)],{objectMode:false}),child.stdin),pipeline(child.stdout,new Writable({highWaterMark:1,write(c,e,cb){parts.push(c);setTimeout(cb,1);}}))]);child.stderr.resume();output.pipeline={status:await done,size:Buffer.concat(parts).length,content:Buffer.concat(parts).every(x=>x===17)};
}
{
    const child=spawn('binary'),done=close(child);child.stdin.end();
    const collect=async stream=>{const parts=[];for await(const c of stream)parts.push(c);return Buffer.concat(parts).toString('hex');};
    output.iterator={data:await Promise.all([collect(child.stdout),collect(child.stderr)]),status:await done};
}
{
    const children=Array.from({length:4},()=>spawn('input'));
    const jobs=children.map(async(child,index)=>{const done=close(child),chunks=[];child.stdout.on('data',c=>chunks.push(c));child.stderr.resume();child.stdin.end(Buffer.alloc(12000,index));const status=await done;return [status,Buffer.concat(chunks).length,Buffer.concat(chunks)[0]];});
    const independent=Promise.all([fsp.readFile(fixture),promisify(hkdf)('sha256','key','salt','info',16)]).then(([file,key])=>file.length>0 && key.byteLength===16);
    output.concurrent={children:await Promise.all(jobs),otherBackends:await independent};
}
{
    const child=spawn('sleep'),done=close(child);await new Promise(resolve=>child.once('spawn',resolve));output.killZero=[child.kill(0),child.killed];child.kill();output.killZeroStatus=await done;
}
{
    const root=fs.mkdtempSync(path.join(process.cwd(),'.child-unref-')),marker=path.join(root,'marker');
    try {
        const platform=cp.spawnSync(process.execPath,['-e','console.log(process.platform)'],{encoding:'utf8',windowsHide:true,timeout:5000});output.selfPlatform=[platform.status,platform.stdout.trim()===process.platform];
        const parent=path.join(path.dirname(fixture),'child-unref-parent.mjs'),args=[...(process.versions.node?[]:['-m']),parent];
        const value=cp.spawnSync(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:5000,env:{...process.env,QJS_UNREF_SCRIPT:fixture,QJS_UNREF_MARKER:marker}});const deadline=Date.now()+1500;
        if(value.status!==0)console.error('unref parent: '+value.stderr?.toString());
        let markerValue=null;
        while(Date.now()<deadline){
            try{markerValue=fs.readFileSync(marker,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
            if(markerValue==='done')break;
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        output.unref={status:value.status,marker:markerValue};
    }finally{fs.rmSync(root,{recursive:true,force:true});}
}
check(output.flood.progress,'timers advance while pipes are active');check(output.pipeline.content,'pipeline content');
result(output);
