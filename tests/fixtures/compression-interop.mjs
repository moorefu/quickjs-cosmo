import fs from 'node:fs';
import zlib from 'node:zlib';
const [operation,codec,input,output,options='{}']=process.argv.slice(2);
const extension=codec==='lz4' || codec==='bzip2';
const api=extension?await import('cosmo:compression'):zlib;
const name=extension?codec+(operation==='compress'?'CompressSync':'DecompressSync'):
    codec==='zstd'?'zstd'+(operation==='compress'?'CompressSync':'DecompressSync'):
    codec==='gzip'?(operation==='compress'?'gzipSync':'gunzipSync'):
    codec==='raw'?(operation==='compress'?'deflateRawSync':'inflateRawSync'):
    operation==='compress'?'deflateSync':'inflateSync';
fs.writeFileSync(output,api[name](fs.readFileSync(input),JSON.parse(options)));
