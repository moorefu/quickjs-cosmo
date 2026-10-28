import tls from 'node:tls';import bareTLS from 'tls';
import assert from 'node:assert/strict';import * as os from 'os';
assert.equal(tls,bareTLS);assert.equal((await import('node:tls')).default,tls);
for(const option of [{rejectUnauthorized:false},{minVersion:'TLSv1.3'},{ALPNProtocols:['h2']},{socket:{}},{checkServerIdentity:()=>undefined}])assert.throws(()=>tls.connect({port:1,...option}),{code:'ERR_NOT_SUPPORTED'});
const worker=new os.Worker('./fixtures/tls-worker.mjs');
const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('TLS Worker timeout')),15000);worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;resolve(data);};worker.postMessage(null);});
assert.equal(message.error,undefined);assert.equal(message.authorized,true);assert.equal(message.echo,'TLS Worker 中文');
console.log('PASS runtime-tls');
