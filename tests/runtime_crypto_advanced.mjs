import './node/crypto-keys.mjs';
import './node/crypto-aead.mjs';
import './node/crypto-aead-errors.mjs';
import c from 'node:crypto';
import assert from 'node:assert/strict';
import * as os from 'os';
// Security exceptions to the pinned Node/OpenSSL baseline: a missing tag and
// late AAD must never turn ChaCha20-Poly1305 into unauthenticated encryption.
for(const name of ['aes-128-gcm','aes-192-gcm','aes-256-gcm','chacha20-poly1305']){
    const size={'aes-128-gcm':16,'aes-192-gcm':24,'aes-256-gcm':32,'chacha20-poly1305':32}[name];
    for(const length of [0,19]){
        const key=Buffer.alloc(size),iv=Buffer.alloc(12),cipher=c.createCipheriv(name,key,iv);
        const ciphertext=Buffer.concat([cipher.update(Buffer.alloc(length,65)),cipher.final()]);
        const decipher=c.createDecipheriv(name,key,iv);decipher.update(ciphertext);
        assert.throws(()=>decipher.final());
    }
    const late=c.createCipheriv(name,Buffer.alloc(size),Buffer.alloc(12));late.update('message');
    assert.throws(()=>late.setAAD('late'),{code:'ERR_CRYPTO_INVALID_STATE'});late.final();
}
const pair=c.generateKeyPairSync('ed25519');
assert.throws(()=>pair.privateKey.export({format:'jwk'}),{code:'ERR_NOT_SUPPORTED'});
assert.throws(()=>c.createPrivateKey({key:'encrypted',format:'jwk'}),{code:'ERR_NOT_SUPPORTED'});
const worker=new os.Worker('./fixtures/crypto-advanced-worker.mjs');
const value=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('advanced crypto Worker timeout')),30000);
    worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;data.error?reject(Error(data.error)):resolve(data);};
    worker.postMessage('Worker 密钥与加密😀');
});
assert.equal(value.text,'Worker 密钥与加密😀');assert.equal(value.verified,true);assert.equal(value.missingTag,true);
console.log('PASS runtime-crypto-advanced');
