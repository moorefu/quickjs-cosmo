import './node/stream.mjs';
import './node/stream-errors.mjs';
import './node/stream-iterate.mjs';
import {Readable,Writable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import assert from 'node:assert/strict';
import * as os from 'os';
const worker=new os.Worker('./fixtures/stream-worker.mjs');
const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('stream Worker timeout')),10000);
    worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;resolve(data);};worker.postMessage([1,2,3]);
});
assert.equal(JSON.stringify(result),'[2,4,6]');
let ticks=0;const interval=setInterval(()=>ticks++,1),values=[];
try{await pipeline(Readable.from(Array.from({length:20},(_,i)=>i)),new Transform({objectMode:true,highWaterMark:1,transform(c,e,cb){cb(null,c+1);}}),new Writable({objectMode:true,highWaterMark:1,write(c,e,cb){values.push(c);setTimeout(cb,1);}}));assert(ticks>0);assert.equal(values.length,20);}finally{clearInterval(interval);}
console.log('PASS runtime-stream');
