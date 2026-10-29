import zlib from 'node:zlib';
import {promisify} from 'node:util';
import {check,result,errorOf} from './fixtures/result.mjs';
const output={codecs:{}};
const source=Buffer.from('中文😀\0async-compression-'.repeat(100));
const pairs=[['gzip','gunzip'],['deflate','inflate'],['deflateRaw','inflateRaw'],['zstdCompress','zstdDecompress']].filter(([name])=>process.env.QUICKJS_COSMO_RUNTIME_PROFILE!=='base'||!name.startsWith('zstd'));
for(const [encode,decode] of pairs) {
    const encoded=await promisify(zlib[encode])(source),decoded=await promisify(zlib[decode])(encoded);
    check(decoded.equals(source),encode+' roundtrip');
    output.codecs[encode]=[Buffer.isBuffer(encoded),Buffer.isBuffer(decoded),decoded.length,decoded.equals(source)];
}
const compressed=await promisify(zlib.gzip)(source);output.unzip=(await promisify(zlib.unzip)(compressed)).equals(source);
const dictionary=Buffer.from('hello world'),data=Buffer.from('hello world hello world');
const deflated=await promisify(zlib.deflate)(data,{dictionary,chunkSize:64,level:9});
output.dictionary=(await promisify(zlib.inflate)(deflated,{dictionary,chunkSize:64})).equals(data);
const view=new DataView(Uint8Array.of(9,0,1,2,255,8).buffer,1,4);
output.view=(await promisify(zlib.gunzip)(await promisify(zlib.gzip)(view))).toString('hex');
let synchronous=true;
const cb=new Promise((resolve,reject)=>zlib.gzip(source,(error,value)=>{if(error)return reject(error);output.callback=[!synchronous,Buffer.isBuffer(value)];resolve();}));
synchronous=false;await cb;
async function failed(fn){try{await fn();return null;}catch(error){return {name:error.name,code:error.code,errno:error.errno??null};}}
output.corrupt=await failed(()=>promisify(zlib.gunzip)(Buffer.from('invalid')));
output.limit=await failed(()=>promisify(zlib.gunzip)(compressed,{maxOutputLength:10}));
output.truncated=await failed(()=>promisify(zlib.gunzip)(compressed.subarray(0,-2)));
output.validation={callback:errorOf(()=>zlib.gzip(source,{},1)),input:errorOf(()=>zlib.gzip(1,()=>{})),level:errorOf(()=>zlib.gzip(source,{level:10},()=>{}))};
const aborted=new AbortController();aborted.abort('stop');
output.aborted=await failed(()=>promisify(zlib.gzip)(source,{signal:aborted.signal}));
let ticks=0;const timer=setInterval(()=>ticks++,1);
const large=Buffer.alloc(8*1024*1024,97);await promisify(zlib.gzip)(large,{level:9});clearInterval(timer);
output.nonblocking=ticks>0;check(output.nonblocking,'gzip must not block timers');
result(output);
