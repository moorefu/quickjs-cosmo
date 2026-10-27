import fs from 'node:fs';
import zlib from 'node:zlib';
import {pipeline} from 'node:stream/promises';
const [operation,codec,input,output,options='{}']=process.argv.slice(2);
const extension=codec==='lz4' || codec==='bzip2';
const api=extension?await import('cosmo:compression'):zlib;
const name=extension?codec+(operation==='compress'?'CompressSync':'DecompressSync'):
    codec==='zstd'?'zstd'+(operation==='compress'?'CompressSync':'DecompressSync'):
    codec==='gzip'?(operation==='compress'?'gzipSync':'gunzipSync'):
    codec==='raw'?(operation==='compress'?'deflateRawSync':'inflateRawSync'):
    operation==='compress'?'deflateSync':'inflateSync';
const supplied=JSON.parse(options);
if(supplied.stream && !extension){
    const constructor=codec==='zstd'?(operation==='compress'?'ZstdCompress':'ZstdDecompress'):
        codec==='gzip'?(operation==='compress'?'Gzip':'Gunzip'):
        codec==='raw'?(operation==='compress'?'DeflateRaw':'InflateRaw'):
        operation==='compress'?'Deflate':'Inflate';
    await pipeline(fs.createReadStream(input,{highWaterMark:4093}),new zlib[constructor](supplied),fs.createWriteStream(output));
}else fs.writeFileSync(output,api[name](fs.readFileSync(input),supplied));
