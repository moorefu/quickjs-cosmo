import {createHmac, hkdfSync, pbkdf2Sync, timingSafeEqual, randomBytes, randomFillSync, randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {check, result, errorOf} from './fixtures/result.mjs';

const vectors = {};
for (const algorithm of ['md5','sha1','sha224','sha256','sha384','sha512']) {
    vectors[algorithm] = [createHmac(algorithm, Buffer.alloc(200,0xaa)).update('data').digest('hex'),
        Buffer.from(hkdfSync(algorithm,'key','salt','info',42)).toString('hex'),
        pbkdf2Sync('password','salt',2,73,algorithm).toString('hex')];
}
const errors={};
const calls = {
    digest:()=>hkdfSync(1,'','','',1), info:()=>hkdfSync('sha256','','',Buffer.alloc(1025),1),
    hkdfLarge:()=>hkdfSync('sha256','','','',8161), hkdfZero:()=>hkdfSync('sha256','','','',0),
    pbkdfZero:()=>pbkdf2Sync('','',1,0,'sha256'), iterations:()=>pbkdf2Sync('','',0,1,'sha256'),
    fractional:()=>pbkdf2Sync('','',1.5,1,'sha256'), unknown:()=>pbkdf2Sync('','',1,1,'nope'),
    badKey:()=>createHmac('sha256',{}), mismatch:()=>timingSafeEqual(Buffer.alloc(1),Buffer.alloc(2)),
    stringCompare:()=>timingSafeEqual('a','a'), randomNaN:()=>randomBytes(NaN), randomNegative:()=>randomBytes(-1),
    fillOffset:()=>randomFillSync(Buffer.alloc(1),'0'), fillBound:()=>randomFillSync(Buffer.alloc(2),1,2),
    uuidOptions:()=>randomUUID(null), uuidCache:()=>randomUUID({disableEntropyCache:1}),
};
for (const [name,call] of Object.entries(calls)) errors[name]=errorOf(call);
const outer = Buffer.alloc(16,0x7d), sub = outer.subarray(3,13);
check(randomFillSync(sub,2,4) === sub,'fill returns original');
check(outer.subarray(0,5).every(x=>x===0x7d) && outer.subarray(9).every(x=>x===0x7d),'fill respects view range');
const u16 = new Uint16Array(4), u8 = new Uint8Array(u16.buffer); u8.fill(0x5a);
check(randomFillSync(u16,0.5,0.5) === u16,'fraction scaled');
check(u8[0]===0x5a && u8.subarray(2).every(x=>x===0x5a),'scaled fill bounds');
const shared = new SharedArrayBuffer(3); randomFillSync(shared);
const empty = Buffer.alloc(0); check(randomFillSync(empty)===empty,'empty fill');
const uuids = [randomUUID(),randomUUID({disableEntropyCache:true})];
check(uuids.every(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)),'UUID layout');
result({vectors, errors, random:[randomBytes(0).length,randomBytes(1.5).length,Buffer.isBuffer(randomBytes(8))],
    compare:[timingSafeEqual(new Uint8Array([1,2]),new DataView(Uint8Array.of(1,2).buffer)),
        timingSafeEqual(new Uint8Array([1,2]),new Uint8Array([1,3])),timingSafeEqual(shared,shared)],
    emptyKdf: [Buffer.from(hkdfSync('sha256','','','',1)).toString('hex'),pbkdf2Sync('','',1,1,'sha256').toString('hex')],
    types:[hkdfSync('sha256','k','s','i',1).constructor.name,Buffer.isBuffer(pbkdf2Sync('k','s',1,1,'sha256'))]});
