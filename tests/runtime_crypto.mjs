import './node/crypto.mjs';
import './node/crypto-state.mjs';
import './node/crypto-kdf-random.mjs';
import './node/crypto-inputs.mjs';
import crypto from 'node:crypto';
import {blake2b256} from 'cosmo:crypto';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as std from 'std';
assert.equal(blake2b256('').toString('hex'),'0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8');
assert.equal(blake2b256('abc').toString('hex'),'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319');
for (const [length,hex] of [
    [1,'8928aae63c84d87ea098564d1e03ad813f107add474e56aedd286349c0c03ea4'],
    [127,'59e2f1aba240f20aa591016f5ef429990bc9c2131dcd0d30f0ffd75ed18f317d'],
    [128,'ae2aa48507885c4c950fb809b2076f959cde9f8ea6da260d9a3587df33dac450'],
    [129,'2f64744a6de0d2c0b56e64cf6e29a5aaa255010d415d51c75ccc82f73dccd865'],
    [1024,'429a8da4b441846d77a952b16a9d4bef4e40c73b1036c8f84a31279d13ec1aaa']]) {
    assert.equal(blake2b256(Buffer.alloc(length,97)).toString('hex'),hex);
}
assert.equal(Buffer.from(crypto.hkdfSync('sha256',Buffer.alloc(22,0x0b),Buffer.from('000102030405060708090a0b0c','hex'),
    Buffer.from('f0f1f2f3f4f5f6f7f8f9','hex'),42)).toString('hex'),
    '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
assert.equal(crypto.createHmac('sha256',Buffer.alloc(20,0x0b)).update('Hi There').digest('hex'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
assert.throws(()=>blake2b256('abc','ignored key'));
assert.equal((await new Promise((resolve,reject)=>crypto.randomBytes(1,(error,data)=>error?reject(error):resolve(data)))).length,1);
const worker=new os.Worker('./fixtures/crypto-worker.mjs');
const timer=os.setTimeout(()=>std.exit(1),10000);
try {
    const result=await new Promise(resolve=>{worker.onmessage=({data})=>resolve(data);worker.postMessage({input:'abc'});});
    assert.equal(result.hash,crypto.createHash('sha256').update('abc').digest('hex'));
    assert.equal(result.blake,blake2b256('abc').toString('hex'));
    assert.equal(result.random,17);
} finally {worker.onmessage=null;os.clearTimeout(timer);}
console.log('PASS runtime-crypto');
