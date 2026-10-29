import z from 'node:zlib';
import {Buffer} from 'node:buffer';
import {result} from './fixtures/result.mjs';
if(process.env.QUICKJS_COSMO_RUNTIME_PROFILE!=='base'){
const outcomes={};
function record(name,call) {
    try {const value=call();outcomes[name]=Buffer.isBuffer(value)?['Buffer',value.toString('hex')]:value;}
    catch(error) {outcomes[name]={name:error.name,code:error.code??null,errno:error.errno??null};}
}
for (const options of [undefined,{params:{100:1}},{params:{100:15,201:true}},
    {params:{100:-2}},{params:{100:NaN}},{params:{100:-1}},{chunkSize:64},
    {params:{200:0,201:1}},{pledgedSrcSize:3000}]) {
    record('roundtrip-'+JSON.stringify(options),()=>{
        const data=Buffer.from('abc'.repeat(1000));
        return z.zstdDecompressSync(z.zstdCompressSync(data,options)).equals(data);
    });
}
const first=z.zstdCompressSync('one'), second=z.zstdCompressSync('two');
const skip=Buffer.from('502a4d1803000000616263','hex');
for(const [name,data] of [['concat',Buffer.concat([first,second])],['skip',Buffer.concat([skip,first])],
    ['tail',Buffer.concat([first,Buffer.from('x')])],['truncated',first.subarray(0,first.length-1)],
    ['empty',Buffer.alloc(0)],['invalid',Buffer.from('invalid')]]) {
    record(name,()=>z.zstdDecompressSync(data));
    record(name+'Strict',()=>z.zstdDecompressSync(data,{rejectGarbageAfterEnd:true}));
}
const large=z.zstdCompressSync(Buffer.alloc(128,97));
record('concatenatedExactChunk',()=>z.zstdDecompressSync(Buffer.concat([large,second]),{chunkSize:64}).length);
record('exactLimit',()=>z.zstdDecompressSync(large,{maxOutputLength:128}).length);
record('overLimit',()=>z.zstdDecompressSync(large,{maxOutputLength:127}));
record('wrongPledge',()=>z.zstdCompressSync('abc',{pledgedSrcSize:2}));
record('dictionary',()=>{
    const dictionary=Buffer.from('hello world'.repeat(100));
    return z.zstdDecompressSync(z.zstdCompressSync('hello world',{dictionary}),{dictionary});
});
record('paramUnknown',()=>z.zstdCompressSync('abc',{params:{999:1}}));
record('paramWrongValue',()=>z.zstdCompressSync('abc',{params:{100:'1'}}));
record('paramRange',()=>z.zstdCompressSync('abc',{params:{101:99}}));
record('decodeParamRange',()=>z.zstdDecompressSync(first,{params:{100:99}}));
record('finishRange',()=>z.zstdCompressSync('abc',{finishFlush:3}));
record('dataView',()=>z.zstdDecompressSync(z.zstdCompressSync(new DataView(Uint8Array.of(0,1,2).buffer,1,2))));
const corrupt=z.zstdCompressSync('checksum',{params:{201:1}});corrupt[corrupt.length-1]^=1;
record('checksum',()=>z.zstdDecompressSync(corrupt));
result(outcomes);

}
