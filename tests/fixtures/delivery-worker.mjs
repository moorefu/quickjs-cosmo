import * as os from 'os';
import assert from 'node:assert/strict';
import process from 'node:process';
os.Worker.parent.onmessage=async()=>{
    try {
        const c=Object.freeze(new AbortController());Object.freeze(c.signal);c.abort(c.signal);assert.equal(c.signal.reason,c.signal);
        const target=Object.freeze(new EventTarget());let calls=0;target.addEventListener('x',()=>calls++);target.dispatchEvent(new Event('x'));assert.equal(calls,1);
        await assert.rejects(import('node:fs\0ignored'),{code:'ERR_UNKNOWN_BUILTIN_MODULE'});
        assert.equal(typeof import.meta.filename,import.meta.url.startsWith('file:')?'string':'undefined');
        await new Promise((resolve,reject)=>process.stdout.write('',error=>error?reject(error):resolve()));
        const code=await new Promise(resolve=>{process.stdin.once('error',error=>resolve(error.code));process.stdin.resume();});
        assert.equal(code,'ERR_WORKER_UNSUPPORTED_OPERATION');
        os.Worker.parent.onmessage=null;os.Worker.parent.postMessage({ok:true});
    } catch(error) {os.Worker.parent.onmessage=null;os.Worker.parent.postMessage({error:String(error.stack)});}
};
