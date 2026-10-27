import childProcess,{type SpawnSyncReturns} from 'node:child_process';
import {spawnSync} from 'child_process';
const raw:SpawnSyncReturns<Buffer>=spawnSync('program',['arg'],{input:new DataView(new ArrayBuffer(3)),maxBuffer:0});
const text:SpawnSyncReturns<string>=childProcess.spawnSync('program',{encoding:'utf8',stdio:['ignore','pipe',{fd:2}]});
const value:string=childProcess.execFileSync('program',['arg'],{encoding:'utf8'});
const shell:Buffer=childProcess.execSync('echo shell',{windowsHide:true});
void [raw,text,value,shell];
// @ts-expect-error Async children belong to M3-04.
childProcess.spawn('program');
// @ts-expect-error Child input accepts views, not plain ArrayBuffer.
spawnSync('program',{input:new ArrayBuffer(4)});
// @ts-expect-error Detached behavior is outside the first batch.
spawnSync('program',{detached:true});
// @ts-expect-error Only three standard descriptors are currently supported.
spawnSync('program',{stdio:['pipe','pipe','pipe','pipe']});
