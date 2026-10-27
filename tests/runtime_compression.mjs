import './node/compression.mjs';
import './node/compression-options.mjs';
import './node/compression-zstd.mjs';
import c from 'cosmo:compression';
import z from 'node:zlib';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as std from 'std';
assert.equal(c.crc32c('123456789'),0xe3069283);
assert.equal(c.crc32c('56789',c.crc32c('1234')),0xe3069283);
assert.equal(c.adler32('Wikipedia'),0x11e60398);
assert.equal(c.adler32('pedia',c.adler32('Wiki')),0x11e60398);
assert.notEqual(c.crc32c('123456789'),z.crc32('123456789'));
for(const [compress,decompress,options] of [
    [c.lz4CompressSync,c.lz4DecompressSync,{}],
    [c.lz4CompressSync,c.lz4DecompressSync,{level:12,checksum:true,blockSize:4}],
    [c.bzip2CompressSync,c.bzip2DecompressSync,{level:1}],
    [c.bzip2CompressSync,c.bzip2DecompressSync,{level:9,small:true}]]) {
    for (const length of [0,1,257,65536,65537,131073]) {
        const input=Buffer.alloc(length);
        for(let i=0;i<length;i++) input[i]=(i*131+(i>>8))&255;
        const compressed=compress(input,options);
        assert(decompress(compressed,options.small?{small:true}:{}).equals(input));
        assert.equal(decompress(Buffer.concat([compressed,compress('tail',options)])).length,input.length+4);
        assert.throws(()=>decompress(compressed.subarray(0,compressed.length-1)),{code:'ERR_COMPRESSION_DATA'});
        const corrupt=Buffer.from(compressed); corrupt[0]^=1;
        assert.throws(()=>decompress(corrupt),{code:'ERR_COMPRESSION_DATA'});
        if (input.length>1) {
            assert.throws(()=>decompress(compressed,{maxOutputLength:input.length-1}),{code:'ERR_BUFFER_TOO_LARGE'});
        }
    }
}
const skip=Buffer.from('502a4d1803000000616263','hex');
assert.equal(c.lz4DecompressSync(Buffer.concat([skip,c.lz4CompressSync('after-skip')])).toString(),'after-skip');
for (const [compress,decompress,options] of [[c.lz4CompressSync,c.lz4DecompressSync,{checksum:true}],
    [c.bzip2CompressSync,c.bzip2DecompressSync,{}]]) {
    const corrupt=compress('checksum payload'.repeat(100),options);corrupt[corrupt.length-5]^=1;
    assert.throws(()=>decompress(corrupt),{code:'ERR_COMPRESSION_DATA'});
}
assert.throws(()=>z.zstdCompressSync('x',{params:{400:1}}),{code:'ERR_NOT_SUPPORTED'});
const info=z.gzipSync('x',{info:true});
assert(info.engine instanceof z.Gzip);assert.equal(info.engine.bytesWritten,1);
assert.equal(z.gunzipSync(info.buffer).toString(),'x');
const names=c.codecInfo().map(record=>record.name);assert.equal(names.join(','),'zlib,zstd,lz4,bzip2');
assert(c.codecInfo('lz4').version.length>0);
const worker=new os.Worker('./fixtures/compression-worker.mjs');
const timer=os.setTimeout(()=>std.exit(1),10000);
try {
    const response=await new Promise(resolve=>{worker.onmessage=({data})=>resolve(data);worker.postMessage('abc');});
    assert.equal(response.value,'abc');assert.equal(response.crc,0xe3069283);
} finally {worker.onmessage=null;os.clearTimeout(timer);}
console.log('PASS runtime-compression');
