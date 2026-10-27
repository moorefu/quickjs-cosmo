import * as os from 'os';
import z from 'node:zlib';
import c from 'cosmo:compression';
const parent=os.Worker.parent;
parent.onmessage=({data})=>{
    const bytes=c.bzip2DecompressSync(c.bzip2CompressSync(z.gunzipSync(z.gzipSync(data))));
    parent.postMessage({value:bytes.toString(),crc:c.crc32c('123456789')});
    parent.onmessage=null;
};
