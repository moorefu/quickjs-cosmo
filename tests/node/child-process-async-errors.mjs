import cp from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {result,errorOf} from './fixtures/result.mjs';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE||process.execPath,fixture=path.resolve(path.dirname(process.argv[1]),'fixtures/child.mjs'),base={windowsHide:true};
const output={};
function errorShape(e){return {name:e.name,code:e.code??null,errno:e.errno??null,signal:e.signal??null,killed:e.killed??null,path:e.path===executable?'executable':e.path??null,syscall:e.syscall?.split(' ')[0]??null};}
async function absent(file,options={}) {
    const events=[],child=cp.spawn(file,[],{...base,...options});child.on('spawn',()=>events.push('spawn'));child.on('exit',()=>events.push('exit'));let error;
    child.on('error',e=>{events.push('error');error=e;});const close=await new Promise(resolve=>child.on('close',(code,signal)=>resolve([code,signal])));events.push('close');return {error:errorShape(error),events,close,pid:child.pid??null};
}
output.missing=await absent('qjs-async-no-such-executable');
output.cwd=await absent(executable,{cwd:path.join(process.cwd(),'qjs-async-no-such-directory')});
for(const [name,mode,args,options] of [
    ['exit','exit',['5'],{}],['stdoutMax','flood',[],{maxBuffer:31}],['zeroMax','binary',[],{maxBuffer:0}],['timeout','sleep',[],{timeout:30}],['buffer','binary',[],{encoding:'buffer'}],['nullEncoding','binary',[],{encoding:null}],['undefinedEncoding','binary',[],{encoding:undefined}],['invalidEncoding','binary',[],{encoding:'bad'}]
]) {
    try{const value=await promisify(cp.execFile)(executable,[fixture,mode,...args],{...base,...options});output[name]={stdout:Buffer.isBuffer(value.stdout)?value.stdout.toString('hex'):value.stdout,stderr:Buffer.isBuffer(value.stderr)?value.stderr.toString('hex'):value.stderr,buffer:Buffer.isBuffer(value.stdout)};}
    catch(e){output[name]={error:errorShape(e),stdout:Buffer.isBuffer(e.stdout)?e.stdout.toString('hex'):e.stdout,stderr:Buffer.isBuffer(e.stderr)?e.stderr.toString('hex'):e.stderr};}
}
for(const before of [false,true]) {
    const controller=new AbortController();if(before)controller.abort('reason');
    const child=cp.spawn(executable,[fixture,'sleep'],{...base,signal:controller.signal});const events=[];let error;
    child.on('spawn',()=>events.push('spawn'));child.on('error',e=>{error=e;events.push('error');});child.on('exit',()=>events.push('exit'));
    const close=new Promise(resolve=>child.on('close',(code,signal)=>resolve([code,signal])));if(!before)setTimeout(()=>controller.abort('reason'),25);
    const status=await close;events.push('close');output['abort'+before]={error:errorShape(error),cause:error.cause,events,status,killed:child.killed};
}
{
    const child=cp.spawn(executable,[fixture,'sleep'],base),closed=new Promise(resolve=>child.on('close',(code,signal)=>resolve([code,signal])));let killed;child.once('spawn',()=>killed=child.kill('SIGTERM'));output.kill={status:await closed,returned:killed,killed:child.killed,after:child.kill()};
}
output.validation=[()=>cp.spawn(1),()=>cp.spawn(''),()=>cp.spawn(executable,[],{signal:{}}),()=>cp.spawn(executable,[],{timeout:-1}),()=>cp.execFile(executable,[],{maxBuffer:-1}),()=>new cp.ChildProcess().kill('NO_SIGNAL')].map(errorOf);
result(output);
