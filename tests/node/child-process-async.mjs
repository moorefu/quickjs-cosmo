import cp from 'node:child_process';
import bare from 'child_process';
import {Readable,Writable} from 'node:stream';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {check,result} from './fixtures/result.mjs';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE||process.execPath;
const fixture=path.resolve(path.dirname(process.argv[1]),'fixtures/child.mjs');
const base={windowsHide:true};
async function run(mode,args=[],options={},input,onExit) {
    const child=cp.spawn(executable,[fixture,mode,...args],{...base,...options}),events=[],parts=[[],[]],closed=[false,false,false];
    child.on('spawn',()=>events.push('spawn'));child.on('exit',()=>{events.push('exit');onExit?.(child);});
    child.stdio.forEach((stream,i)=>{if(stream)stream.on('close',()=>closed[i]=true);else closed[i]=true;});
    child.stdout?.on('data',data=>parts[0].push(data));child.stderr?.on('data',data=>parts[1].push(data));
    const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
    const identity=child instanceof cp.ChildProcess && (!child.stdout||child.stdout instanceof Readable) && (!child.stdin||child.stdin instanceof Writable);
    const unrefValue=child.unref(),refValue=child.ref(),refReturn=[unrefValue===undefined,refValue===undefined];
    child.stdin?.end(input);const status=await done;events.push('close');
    return {child,status,events,closed,identity,refReturn,stdout:Buffer.concat(parts[0]),stderr:Buffer.concat(parts[1])};
}
function shape(r){return {status:r.status,events:r.events,closed:r.closed,identity:r.identity,refReturn:r.refReturn,pid:r.child.pid>0,killed:r.child.killed,exitCode:r.child.exitCode,signalCode:r.child.signalCode,stdout:r.stdout.toString('hex'),stderr:r.stderr.toString('hex')};}
const output={identity:cp===bare};
output.binary=shape(await run('binary'));
output.exit=shape(await run('exit',['7']));
output.highExit=shape(await run('exit',['-1']));
output.input=shape(await run('input',[],{},new DataView(Uint8Array.of(9,0,1,2,255,8).buffer,1,4)));
output.ignored=shape(await run('exit',['0'],{stdio:'ignore'}));
const args=['','space value','a"b','a\\"b','tail\\','/C/literal','中文😀'];
const echo=await run('echo',args,{env:{...process.env,CHILD_TOKEN:'async-token'},argv0:'custom-name'});
const decoded=JSON.parse(echo.stdout);output.echo={args:decoded.args,cwd:decoded.cwd===process.cwd(),token:decoded.token,argv0:decoded.argv0,pid:decoded.pid===echo.child.pid,spawnfile:echo.child.spawnfile===executable,spawnargs:echo.child.spawnargs.map(x=>x===fixture?'fixture':x===executable?'executable':x)};
const root=fs.mkdtempSync(path.join(process.cwd(),'.child-async-'));
try {
    const cwd=await run('echo',[],{cwd:root});output.cwd=JSON.parse(cwd.stdout).cwd===root;
    const fd=fs.openSync(path.join(root,'out'),'w+');try{let exitCursor;const redirected=await run('stdio',[],{stdio:['ignore',fd,fd]},undefined,()=>exitCursor=fs.readFileSync(fd).length);output.redirect={stdio:redirected.child.stdio,cursor:fs.readFileSync(fd).length,exitCursor};}finally{fs.closeSync(fd);}
    output.redirectContent=fs.readFileSync(path.join(root,'out'),'utf8');
}finally{fs.rmSync(root,{recursive:true,force:true});}
const execResult=await promisify(cp.execFile)(executable,[fixture,'binary'],{...base,encoding:'hex'});output.execFile=execResult;
const promise=promisify(cp.execFile)(executable,[fixture,'echo','promise'],base);output.promiseChild=promise.child instanceof cp.ChildProcess;output.promiseEcho=JSON.parse((await promise).stdout).args;
output.exec=(await promisify(cp.exec)('echo async-shell',{windowsHide:true})).stdout.trim();
check(output.binary.identity,'stdio stream identity');check(output.echo.args.length===args.length,'arguments');
result(output);
