import crypto, {type Hash, type Hmac} from 'node:crypto';
import {createHash} from 'crypto';
import {blake2b256} from 'cosmo:crypto';
const digest:string=createHash('sha256').update('abc').digest('hex');
const hash:Hash=crypto.createHash('sha512').copy();
const mac:Hmac=crypto.createHmac('sha256',new DataView(new ArrayBuffer(8)));
const key:ArrayBuffer=crypto.hkdfSync('sha256','k','s','i',32);
const data:Buffer=crypto.pbkdf2Sync('p','s',2,32,'sha256');
const uuid:string=crypto.randomUUID({disableEntropyCache:true});
const extension:Buffer=blake2b256('abc');
void [digest,hash,mac,key,data,uuid,extension];
// @ts-expect-error Hash.update accepts views, not plain ArrayBuffers.
hash.update(new ArrayBuffer(1));
crypto.randomBytes(1,()=>{});
// @ts-expect-error Timing comparisons reject strings.
crypto.timingSafeEqual('a','a');
// @ts-expect-error HMAC state cannot be copied.
mac.copy();
