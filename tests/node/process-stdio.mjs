import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=fileURLToPath(new URL('./fixtures/process-stdio-child.mjs',import.meta.url));
const input=Buffer.alloc(262147);for(let i=0;i<input.length;i++)input[i]=i&255;
const out={};
for(const mode of ['echo','pipe','pipeline']){
    const run=spawnSync(process.execPath,[child,mode],{input,maxBuffer:2*1024*1024,timeout:15000});
    if(run.error||run.status!==0)throw Error('Stdio '+mode+': '+String(run.error)+' '+run.stderr);
    out[mode]=mode==='echo'?{value:JSON.parse(run.stdout.toString()),stderr:run.stderr.toString()}:{same:run.stdout.equals(input),length:run.stdout.length,stderr:run.stderr.toString()};
}
for(const mode of ['unref','ref'])out[mode]=await new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,[child,mode]),deadline=setTimeout(()=>{c.kill();reject(Error('Stdio liveness timeout'));},15000);
    let text='',stderr='',kept=null,ready=false;
    c.on('error',reject);c.stderr.on('data',d=>stderr+=d);
    c.stdout.on('data',d=>{text+=d;if(!ready&&text.includes('READY')){ready=true;if(mode==='ref')setTimeout(()=>{kept=c.exitCode===null;c.stdin.end('input');},100);}});
    c.once('close',(code,signal)=>{clearTimeout(deadline);if(code||signal)reject(Error('Stdio liveness exit: '+stderr));else resolve({text,kept});});
});
const arguments_=['D:\\raw\\path','\\\\server\\share\\name','space value','','中文🦊','quoted"value','trailing\\'];
const argsRun=spawnSync(process.execPath,[child,'argv',...arguments_],{timeout:15000});
if(argsRun.error||argsRun.status)throw Error('argv child failed');
out.arguments=JSON.parse(argsRun.stdout.toString());
console.log('NODE_COMPAT_RESULT '+JSON.stringify(out));
