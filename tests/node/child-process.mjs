import cp from 'node:child_process';
import bare from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import {check,result,errorOf} from './fixtures/result.mjs';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE || process.execPath;
const fixture=path.resolve(path.dirname(process.argv[1]),'fixtures/child.mjs');
const base={windowsHide:true};
function run(mode,args=[],options={}){return cp.spawnSync(executable,[fixture,mode,...args],{...base,...options});}
function shape(value) {
    return {pid:value.pid>0,status:value.status,signal:value.signal,error:value.error?{
        name:value.error.name,code:value.error.code,errno:value.error.errno,
        syscall:value.error.syscall.split(' ')[0],path:value.error.path===executable?'executable':value.error.path,
        spawnargs:value.error.spawnargs.map(x=>x===fixture?'fixture':x)}:null,
        stdout:value.stdout==null?value.stdout:Buffer.isBuffer(value.stdout)?value.stdout.toString('hex'):value.stdout,
        stderr:value.stderr==null?value.stderr:Buffer.isBuffer(value.stderr)?value.stderr.toString('hex'):value.stderr,
        output:value.output===null?null:value.output.map(x=>x===null?null:typeof x),
        identity:!!value.output&&value.stdout===value.output[1]&&value.stderr===value.output[2]};
}
const cases={identity:cp===bare};
cases.binary=shape(run('binary'));
cases.encoded=shape(run('binary',[],{encoding:'hex'}));
cases.exit=shape(run('exit',['3']));
cases.highExit=shape(run('exit',['-1']));
cases.ignored=shape(run('exit',['0'],{stdio:'ignore'}));
cases.input=shape(run('input',[],{input:new DataView(Uint8Array.of(9,0,1,2,255,8).buffer,1,4)}));
cases.stringInput=shape(run('input',[],{input:'中文😀',encoding:'utf8'}));
cases.argv0=run('argv0',[],{argv0:'custom-name',encoding:'utf8'}).stdout;
const args=['','space value','a"b','a\\"b','tail\\','/C/literal','中文😀'];
const echoResult=run('echo',args,{encoding:'utf8'}),echo=JSON.parse(echoResult.stdout);
check(echo.cwd===process.cwd(),'child cwd');check(JSON.stringify(echo.args)===JSON.stringify(args),'argument fidelity');
cases.arguments=echo.args;
cases.nativePid=echo.pid===echoResult.pid;
if(process.platform==='win32')cases.uid=shape(run('binary',[],{uid:1}));
else {
    const value=JSON.parse(run('echo',[],{uid:echo.uid,gid:echo.gid,encoding:'utf8'}).stdout);
    cases.uid=[value.uid===echo.uid,value.gid===echo.gid];
}
const root=fs.mkdtempSync(path.join(process.cwd(),'.child-process-'));
try {
    const env=Object.assign(Object.create({PROTOTYPE_TOKEN:'inherited'}),{CHILD_TOKEN:42});
    cases.environment=JSON.parse(run('env',[],{env,encoding:'utf8'}).stdout);
    cases.cwd=JSON.parse(run('echo',[],{cwd:Buffer.from(root),encoding:'utf8'}).stdout).cwd===root;
    const searched=cp.spawnSync(path.basename(executable),[fixture,'env'],{...base,env:{PATH:path.dirname(executable),CHILD_TOKEN:'path'},encoding:'utf8'});
    cases.pathSearch=JSON.parse(searched.stdout);
    const file=path.join(root,'redirected'),fd=fs.openSync(file,'w+');
    try {
        fs.writeSync(fd,'prefix');
        const redirected=run('stdio',[],{stdio:['ignore',fd,fd]});
        cases.redirected=shape(redirected);
        fs.writeSync(fd,'tail');
    } finally {fs.closeSync(fd);}
    cases.file=fs.readFileSync(file,'utf8');check(cases.file==='prefixOUTERRtail','shared descriptor position');
    cases.execFile=cp.execFileSync(executable,[fixture,'input'],{...base,input:'exec-file',encoding:'utf8'});
    cases.execShell=cp.execSync('echo shell-value',{...base,encoding:'utf8'}).trim();
    try{cp.execFileSync(executable,[fixture,'exit','7'],{...base,stdio:'pipe'});}
    catch(error){cases.execError={name:error.name,code:error.code??null,status:error.status,signal:error.signal,stdout:error.stdout.toString(),stderr:error.stderr.toString(),pid:error.pid>0};}
    const missing=cp.spawnSync('quickjs-no-such-program-9382',[],base);cases.missing=shape(missing);
    const missingCwd=run('binary',[],{cwd:path.join(root,'missing')});cases.missingCwd=shape(missingCwd);
} finally {fs.rmSync(root,{recursive:true,force:true});}
cases.validations={nul:errorOf(()=>cp.spawnSync('x\0y')),empty:errorOf(()=>cp.spawnSync('')),
    badFile:errorOf(()=>cp.spawnSync(1)),badArgs:errorOf(()=>cp.spawnSync('x',1)),badOptions:errorOf(()=>cp.spawnSync('x',[],null)),
    badInput:errorOf(()=>run('input',[],{input:new ArrayBuffer(1)})),badTimeout:errorOf(()=>run('binary',[],{timeout:1.5})),
    badMaximum:errorOf(()=>run('binary',[],{maxBuffer:-1})),badSignal:errorOf(()=>run('binary',[],{killSignal:'invalid'})),
    badStdio:errorOf(()=>run('binary',[],{stdio:'bad'})),badUid:errorOf(()=>run('binary',[],{uid:1.5}))};
result(cases);
