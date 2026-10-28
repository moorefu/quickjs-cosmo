import './node/crypto-extra.mjs';
import c from 'node:crypto';
import assert from 'node:assert/strict';
import * as os from 'os';
const worker=new os.Worker('./fixtures/hash-extra-worker.mjs');
const data='SHA3/SHAKE/BLAKE2s Worker 中文😀';
const value=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('extra digest Worker timeout')),30000);
    worker.onmessage=({data:value})=>{clearTimeout(timer);worker.onmessage=null;resolve(value);};worker.postMessage(data);
});
assert.equal(value.shake,c.hash('shake256',data,{outputLength:200}));
assert.equal(value.blake,c.hash('blake2s256',data));
// Extended HMAC/KDF combinations are not admitted by this digest-only cohort.
for(const name of ['sha3-256','shake128','blake2s256'])assert.throws(()=>c.createHmac(name,'key'),{code:'ERR_CRYPTO_INVALID_DIGEST'});
console.log('PASS runtime-hash-extra');
