import * as os from 'os';
import z from 'node:zlib';
import c from 'cosmo:compression';
const parent=os.Worker.parent;
parent.onmessage=({data})=>{
    let bytes=z.gunzipSync(z.gzipSync(data));
    if(process.env.QUICKJS_COSMO_RUNTIME_PROFILE!=='base')bytes=c.bzip2DecompressSync(c.bzip2CompressSync(bytes));
    parent.postMessage({value:bytes.toString(),crc:c.crc32c('123456789')});
    parent.onmessage=null;
};
