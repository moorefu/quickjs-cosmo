import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {Readable,Writable,Transform} from 'node:stream';
import {pipeline,finished} from 'node:stream/promises';
import {promisify} from 'node:util';
import {check,result} from './fixtures/result.mjs';
const output={};
const input=Buffer.from('中文😀-stream-data\0'.repeat(2000));
async function collect(source,slow=false){const chunks=[];await pipeline(source,new Writable({highWaterMark:17,write(c,e,cb){chunks.push(Buffer.from(c));if(slow)setTimeout(cb,1);else cb();}}));return Buffer.concat(chunks);}
for(const name of ['sha256','sha512','blake2b512']){
    const hash=crypto.createHash(name,{highWaterMark:31});hash.setEncoding('hex');
    const data=[];hash.on('data',c=>data.push(c));
    await pipeline(Readable.from([input.subarray(0,1000),input.subarray(1000)]),hash);
    output[name]=[hash instanceof Transform,data.join('')===crypto.createHash(name).update(input).digest('hex')];
}
{
    const mac=crypto.createHmac('sha256','key'),copy=crypto.createHash('sha256').update('prefix').copy();
    const data=collect(mac);mac.end(input);output.hmac=(await data).toString('hex')===crypto.createHmac('sha256','key').update(input).digest('hex');
    const copied=collect(copy);copy.end('tail');output.hashCopy=(await copied).toString('hex')===crypto.createHash('sha256').update('prefixtail').digest('hex');
}
for(const [encode,decode] of [['Deflate','Inflate'],['Gzip','Gunzip'],['DeflateRaw','InflateRaw'],['ZstdCompress','ZstdDecompress']]){
    const encoder=zlib['create'+encode]({chunkSize:257,highWaterMark:97}),decoder=zlib['create'+decode]({chunkSize:311,highWaterMark:73});
    let offset=0,ticks=0;const timer=setInterval(()=>ticks++,1);
    const source=new Readable({read(){if(offset===input.length){this.push(null);return;}const end=Math.min(input.length,offset+7777);this.push(input.subarray(offset,end));offset=end;}});
    const chunks=[];await pipeline(source,encoder,decoder,new Writable({highWaterMark:43,write(c,e,cb){chunks.push(Buffer.from(c));setTimeout(cb,1);}}));clearInterval(timer);
    const restored=Buffer.concat(chunks);check(restored.equals(input),encode+' streaming roundtrip');
    output[encode]=[encoder instanceof zlib[encode],encoder instanceof Transform,decoder instanceof zlib[decode],encoder.bytesWritten===input.length,ticks>0,encoder.closed,decoder.closed];
}
{
    const decoder=zlib.createUnzip({chunkSize:64});const data=collect(decoder);
    const zipped=Buffer.concat([zlib.gzipSync('first'),zlib.gzipSync('second')]);
    for(let i=0;i<zipped.length;i++)decoder.write(zipped.subarray(i,i+1));decoder.end();
    output.members=(await data).toString();
}
{
    const skip=Buffer.from([0x50,0x2a,0x4d,0x18,3,0,0,0,1,2,3]);
    const source=Buffer.concat([zlib.zstdCompressSync('first'),skip,zlib.zstdCompressSync('second')]);
    const decoder=zlib.createZstdDecompress({chunkSize:64}),data=collect(decoder);
    for(let i=0;i<source.length;i++)decoder.write(source.subarray(i,i+1));decoder.end();output.zstdMembers=(await data).toString();
}
{
    const dictionary=Buffer.from('shared dictionary for incremental compression');
    const zipped=await collect(Readable.from([input]).pipe(zlib.createDeflate({dictionary})));
    output.dictionary=(await collect(Readable.from([zipped]).pipe(zlib.createInflate({dictionary})))).equals(input);
}
{
    const gzip=zlib.createGzip({chunkSize:64}),chunks=[];gzip.on('data',c=>chunks.push(c));
    gzip.write('before');await new Promise((resolve,reject)=>gzip.flush(zlib.constants.Z_SYNC_FLUSH,e=>e?reject(e):resolve()));
    output.flushBeforeEnd=chunks.length>0 && zlib.gunzipSync(Buffer.concat(chunks),{finishFlush:zlib.constants.Z_SYNC_FLUSH}).toString()==='before';
    gzip.end('after');await finished(gzip);output.flush=zlib.gunzipSync(Buffer.concat(chunks)).toString();
}
{
    const sync=zlib.gzipSync('info',{info:true}),async=await promisify(zlib.gzip)('async-info',{info:true});
    output.info=[sync.engine instanceof zlib.Gzip,sync.engine.bytesWritten,zlib.gunzipSync(sync.buffer).toString(),async.engine instanceof zlib.Gzip,zlib.gunzipSync(async.buffer).toString()];
}
result(output);
