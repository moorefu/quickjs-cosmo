import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {pipeline,finished} from 'node:stream/promises';
import {check,result} from './fixtures/result.mjs';
const output={};
async function failure(stream,data){try{await pipeline(Readable.from([data]),stream,new Writable({write(c,e,cb){cb();}}));return null;}catch(e){return {code:e.code,errno:e.errno??null,closed:stream.closed};}}
output.invalid=await failure(zlib.createGunzip(),Buffer.from('invalid compressed bytes'));
const compressed=zlib.gzipSync('content'.repeat(300));
output.truncated=await failure(zlib.createGunzip({chunkSize:64}),compressed.subarray(0,-3));
const corrupt=Buffer.from(compressed);corrupt[corrupt.length-8]^=1;
output.checksum=await failure(zlib.createGunzip(),corrupt);
const dictionary=Buffer.from('shared dictionary');
output.dictionary=await failure(zlib.createInflate(),zlib.deflateSync('shared dictionary text',{dictionary}));
output.zstd=await failure(zlib.createZstdDecompress(),Buffer.from('invalid'));
output.zstdTruncated=await failure(zlib.createZstdDecompress(),zlib.zstdCompressSync('truncated').subarray(0,-1));
{
    const hash=crypto.createHash('sha256').update('done');hash.digest();
    output.finalized=await failure(hash,Buffer.from('late'));
}
{
    const controller=new AbortController(),stream=zlib.createGzip({signal:controller.signal});
    const done=finished(stream).catch(e=>[e.name,e.code,stream.closed]);stream.write(Buffer.alloc(65536));controller.abort();output.abort=await done;
}
{
    const stream=zlib.createGzip(),errors=[];stream.on('error',e=>errors.push(e.code));
    stream.write(Buffer.alloc(65536),e=>{if(e)errors.push(e.code);});stream.destroy();
    await new Promise(resolve=>stream.once('close',resolve));output.destroy=[stream.closed,stream.destroyed,errors.filter(e=>e==='ERR_STREAM_DESTROYED').length<=1];
}
{
    const encoder=zlib.createDeflate({level:1}),chunks=[];encoder.on('data',c=>chunks.push(c));encoder.write('before');
    await new Promise((resolve,reject)=>encoder.params(9,zlib.constants.Z_DEFAULT_STRATEGY,e=>e?reject(e):resolve()));
    encoder.end('after');await finished(encoder);output.params=zlib.inflateSync(Buffer.concat(chunks)).toString();
}
{
    const stream=zlib.createDeflate(),parts=[];stream.on('data',c=>parts.push(c));
    stream.write('discarded');await new Promise(resolve=>stream.flush(zlib.constants.Z_SYNC_FLUSH,resolve));parts.length=0;
    stream.reset();stream.end('reset');await finished(stream);output.reset=zlib.inflateSync(Buffer.concat(parts)).toString();
}
{
    const stream=zlib.createUnzip(),parts=[];stream.on('data',c=>parts.push(c));
    await new Promise((resolve,reject)=>stream.write(zlib.gzipSync('first'),e=>e?reject(e):resolve()));parts.length=0;
    stream.reset();stream.end(Buffer.concat([zlib.deflateSync('second'),zlib.gzipSync('ignored')]));
    await finished(stream);output.unzipReset=Buffer.concat(parts).toString();
}
check(output.invalid!==null && output.truncated!==null,'decoder failures must propagate');
result(output);
