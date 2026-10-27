import zlib from 'node:zlib';
import bare from 'zlib';
import {Buffer} from 'node:buffer';
import {result,check} from './fixtures/result.mjs';
const observations={identity:zlib===bare};
function record(name,call) {
    try {const value=call();observations[name]=Buffer.isBuffer(value)?['Buffer',value.toString('hex')]:value;}
    catch(error) {observations[name]={name:error.name,code:error.code??null,errno:error.errno??null};}
}
const input=Buffer.from('abc'.repeat(1000));
for(const [encode,decode] of [['gzipSync','gunzipSync'],['deflateSync','inflateSync'],['deflateRawSync','inflateRawSync']]) {
    for(const options of [{level:0},{level:9,strategy:4,memLevel:1},{windowBits:9},{chunkSize:64},
        {level:2.5,memLevel:7.5},{level:NaN},{level:undefined},null]) {
        record(encode+JSON.stringify(options),()=>zlib[decode](zlib[encode](input,options)).equals(input));
    }
    const compressed=zlib[encode](input);
    record(decode+'tail',()=>zlib[decode](Buffer.concat([compressed,Buffer.from('junk')])).length);
    record(decode+'zeroTail',()=>zlib[decode](Buffer.concat([compressed,Buffer.from([0,0,1])])).length);
    record(decode+'strict',()=>zlib[decode](Buffer.concat([compressed,Buffer.from('junk')]),{rejectGarbageAfterEnd:true}));
    record(decode+'truncated',()=>zlib[decode](compressed.subarray(0,compressed.length-2)));
    record(decode+'partial',()=>zlib[decode](compressed.subarray(0,compressed.length-2),{finishFlush:2}).length);
    record(decode+'limited',()=>zlib[decode](compressed,{maxOutputLength:2999}));
    record(decode+'exactLimit',()=>zlib[decode](compressed,{maxOutputLength:3000}).length);
    record(decode+'bad',()=>zlib[decode](Buffer.from('not compressed')));
    if (encode !== 'deflateRawSync') {
        const corrupt=Buffer.from(compressed);corrupt[corrupt.length-1]^=1;
        record(decode+'checksum',()=>zlib[decode](corrupt));
    }
}
const dictionary=Buffer.from('common words for a dictionary');
const compressed=zlib.deflateSync('common words words words',{dictionary});
record('dictionary',()=>zlib.inflateSync(compressed,{dictionary}));
record('missingDictionary',()=>zlib.inflateSync(compressed));
record('wrongDictionary',()=>zlib.inflateSync(compressed,{dictionary:Buffer.from('wrong')}));
record('rawDictionary',()=>zlib.inflateRawSync(zlib.deflateRawSync('words words',{dictionary}),{dictionary}));
for(const [name,options] of Object.entries({level:{level:10},memory:{memLevel:0},strategy:{strategy:5},
    window:{windowBits:7},chunk:{chunkSize:63},max:{maxOutputLength:0},flush:{finishFlush:6},
    flag:{rejectGarbageAfterEnd:1},dictionary:{dictionary:'text'}})) record('option-'+name,()=>zlib.deflateSync('abc',options));
record('badInput',()=>zlib.gzipSync(1));
const data=Buffer.from([0,1,2,3,4,5]);
record('view',()=>zlib.gunzipSync(zlib.gzipSync(new DataView(data.buffer,data.byteOffset+1,3)))) ;
record('arrayBuffer',()=>zlib.inflateSync(zlib.deflateSync(Uint8Array.of(1,2,3).buffer)));
record('unzipGzip',()=>zlib.unzipSync(zlib.gzipSync('gzip')));
record('unzipZlib',()=>zlib.unzipSync(zlib.deflateSync('zlib')));
record('concat',()=>zlib.gunzipSync(Buffer.concat(Array.from({length:4},(_,i)=>zlib.gzipSync(String(i)))),{chunkSize:64}));
record('crcView',()=>zlib.crc32(new DataView(data.buffer,data.byteOffset+1,3)));
record('crcEmpty',()=>zlib.crc32('',123));
record('crcArrayBuffer',()=>zlib.crc32(new ArrayBuffer(1)));
record('crcInitial',()=>zlib.crc32('a',-1));
const constants=['Z_NO_FLUSH','Z_FINISH','Z_BUF_ERROR','Z_DEFAULT_STRATEGY','Z_MIN_WINDOWBITS','Z_DEFAULT_CHUNK'];
observations.constants=constants.map(name=>[name,zlib.constants[name]]);
observations.codes=[zlib.codes.Z_BUF_ERROR,zlib.codes[-5]];
check(observations.identity,'module identity');
result(observations);
