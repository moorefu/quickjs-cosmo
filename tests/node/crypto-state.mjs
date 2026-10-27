import crypto, {Hash, Hmac, createHash, createHmac, getHashes, hash} from 'node:crypto';
import bare from 'crypto';
import {Buffer} from 'node:buffer';
import {check, result, errorOf} from './fixtures/result.mjs';

const algorithms = ['md5','sha1','sha224','sha256','sha384','sha512','blake2b512'];
const vectors = {}, errors = {};
for (const name of algorithms) {
    check(getHashes().includes(name), 'algorithm advertised: ' + name);
    vectors[name] = [];
    for (const n of [0,1,55,56,63,64,65,111,112,127,128,129,1025]) {
        const data = Buffer.alloc(n, 0x61);
        const first = createHash(name).update(data.subarray(0, Math.floor(n/2)));
        const clone = first.copy();
        const end = data.subarray(Math.floor(n/2));
        const digest = first.update(new DataView(end.buffer, end.byteOffset, end.byteLength)).digest('hex');
        check(digest === clone.update(end).digest('hex'), name + ' copied state');
        vectors[name].push(digest);
    }
}
const branch = createHash('sha256').update('prefix');
const a = branch.copy().update('a').digest('hex'), b = branch.update('b').digest('hex');
check(a !== b, 'independent copies');
const finalized = createHash('sha256'); finalized.digest();
for (const [name, call] of Object.entries({update:()=>finalized.update(null), digest:()=>finalized.digest(), copy:()=>finalized.copy(),
    input:()=>createHash('sha256').update(new ArrayBuffer(1)), unknown:()=>createHash('unknown'),
    oddHex:()=>createHash('sha256').update('a','hex'), wrongLength:()=>createHash('sha256',{outputLength:31}),
    fractionalLength:()=>createHash('sha256',{outputLength:1.5}), receiver:()=>Hash.prototype.update.call({},'a')})) errors[name] = errorOf(call);
const pending = createHash('sha256');
errorOf(()=>pending.update('a','hex'));
const untouched = pending.update('abc').digest('hex');
const mac = createHmac('sha256', new DataView(Uint8Array.of(1,2,3,4).buffer,1,2)).update('data');
const firstMac = mac.digest('hex'), secondMac = mac.digest('hex');
const aliases = ['SHA-256','sha2-256','RSA-SHA256','sha-1'].map(name=>createHash(name).update('abc').digest('hex'));
const representations = [undefined,'buffer','HEX','base64','base64url','unknown',123].map(enc=>{
    const value = createHash('sha256').update('YWJj','base64').digest(enc);
    return [typeof value, Buffer.isBuffer(value), Buffer.isBuffer(value)?value.toString('hex'):value];
});
const fresh = getHashes(); fresh.length=0;
result({vectors, errors, a, b, untouched, firstMac, secondMac, aliases, representations,
    identity: crypto === bare && crypto.Hash === Hash,
    instances: [Hash('sha256') instanceof Hash,Hmac('sha256','k') instanceof Hmac],
    sameUpdate: Hash.prototype.update === Hmac.prototype.update,
    fresh: algorithms.every(name=>getHashes().includes(name)),
    oneShot: [hash('sha256','abc'),hash('sha256','abc','buffer').toString('hex')]});
