import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {check,result,errorOf} from './fixtures/result.mjs';
const derive=promisify(crypto.pbkdf2),expand=promisify(crypto.hkdf);
const output={digests:{}};
for(const digest of ['md5','sha1','sha224','sha256','sha384','sha512']) {
    const [key,bits]=await Promise.all([derive('password','salt',2,32,digest),expand(digest,'secret','salt','info',32)]);
    output.digests[digest]=[Buffer.isBuffer(key),key.toString('hex'),Object.prototype.toString.call(bits),Buffer.from(bits).toString('hex')];
}
const password=Buffer.from('password'),salt=Buffer.from('salt'),pending=derive(password,salt,1000,32,'sha256');
password.fill(0);salt.fill(0);output.snapshot=(await pending).toString('hex');
let synchronous=true;
const callback=new Promise((resolve,reject)=>crypto.pbkdf2('p','s',2,8,'sha256',(error,value)=>{if(error)return reject(error);output.asyncCallback=!synchronous;resolve(value);}));
synchronous=false;await callback;
let randomBytesSync=true;
const randomPromise=new Promise((resolve,reject)=>crypto.randomBytes(16,(error,value)=>{if(error)return reject(error);output.random=[value.length,Buffer.isBuffer(value),!randomBytesSync];resolve();}));
randomBytesSync=false;await randomPromise;
const array=new Uint16Array(8);new Uint8Array(array.buffer).fill(0xa5);
const filled=await promisify(crypto.randomFill)(array,2,3);
output.fill=[filled===array,new Uint8Array(array.buffer).slice(0,4).every(x=>x===0xa5),new Uint8Array(array.buffer).slice(10).every(x=>x===0xa5)];
const ab=new ArrayBuffer(4);output.arrayBuffer=(await promisify(crypto.randomFill)(ab))===ab;
let immediate=false;crypto.randomBytes(0,()=>immediate=true);output.emptyBytes=immediate;
immediate=false;crypto.randomFill(array,1,0,()=>immediate=true);output.emptyFill=immediate;
function failed(fn){return new Promise(resolve=>fn(error=>resolve({name:error.name,code:error.code??null})));}
output.zeroPbkdf=await failed(cb=>crypto.pbkdf2('p','s',1,0,'sha256',cb));
output.zeroHkdf=await failed(cb=>crypto.hkdf('sha256','p','s','i',0,cb));
output.validations={callback:errorOf(()=>crypto.pbkdf2('p','s',1,8,'sha256',1)),digest:errorOf(()=>crypto.hkdf('invalid','p','s','i',8,()=>{})),
    iterations:errorOf(()=>crypto.pbkdf2('p','s',0,8,'sha256',()=>{})),fillOffset:errorOf(()=>crypto.randomFill(array,undefined,undefined,()=>{})),
    fillRange:errorOf(()=>crypto.randomFill(array,8,1,()=>{}))};
let ticks=0;const timer=setInterval(()=>ticks++,1);
await derive('long-password','long-salt',200000,32,'sha512');clearInterval(timer);output.nonblocking=ticks>0;
check(output.nonblocking,'PBKDF2 must not block timers');check(output.asyncCallback,'KDF callback is asynchronous');
result(output);
