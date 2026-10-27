import cp,{spawn,ChildProcess,execFile,type ExecFilePromise} from 'node:child_process';
import {promisify} from 'node:util';
import type {Writable} from 'node:stream';
const child:ChildProcess=spawn('program',['arg'],{signal:new AbortController().signal,stdio:['pipe','pipe','pipe'],windowsHide:true});
const input:Writable|null=child.stdin;
child.stdin?.end(new Uint8Array(4));child.stdout?.setEncoding('utf8').on('data',chunk=>{});
const killed:boolean=child.kill('SIGTERM');const ref:void=child.ref();child.unref();
cp.execFile('program',['arg'],{encoding:'buffer'},(error,stdout,stderr)=>{const out:Buffer=stdout;});
execFile('program',(error,stdout,stderr)=>{const out:string=stdout;});
const p:ExecFilePromise<string>=promisify(execFile)('program',['arg'],{encoding:'utf8'});
const p2:ExecFilePromise<Buffer>=promisify(execFile)('program',{encoding:'buffer'});
const p3:ExecFilePromise<string>=promisify(cp.exec)('echo command');
const pChild:ChildProcess=p.child;
// @ts-expect-error IPC fork is outside this subset
cp.fork('program');
// @ts-expect-error IPC stdio is outside this subset
spawn('program',{stdio:['ipc','pipe','pipe']});
// @ts-expect-error Async spawn has no input option
spawn('program',{input:'data'});
// @ts-expect-error ChildProcess ref does not return a chainable child
const chain:ChildProcess=child.ref();
