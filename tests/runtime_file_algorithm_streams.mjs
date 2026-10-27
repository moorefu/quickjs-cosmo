import './node/file-streams.mjs';
import './node/algorithm-streams.mjs';
import './node/algorithm-stream-errors.mjs';
import * as os from 'os';
import assert from 'node:assert/strict';
const worker=new os.Worker('./fixtures/file-algorithm-stream-worker.mjs');
const value=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('file/algorithm Worker timeout')),30000);
    worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;data.error?reject(Error(data.error)):resolve(data);};
    worker.postMessage('worker pipeline 文件😀');
});
assert.equal(value.content,'worker pipeline 文件😀');assert.equal(value.match,true);
console.log('PASS runtime-file-algorithm-streams');
