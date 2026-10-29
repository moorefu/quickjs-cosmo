import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import compression from 'cosmo:compression';
import {promisify} from 'node:util';
import * as os from 'os';
os.Worker.parent.onmessage=async({data:file})=>{
    const [text,key,encoded]=await Promise.all([fs.readFile(file,'utf8'),promisify(crypto.pbkdf2)('p','s',2,32,'sha256'),promisify(zlib.gzip)('worker-compression')]);
    const decoded=(await promisify(zlib.gunzip)(encoded)).toString();
    let extensions=true;
    if(process.env.QUICKJS_COSMO_RUNTIME_PROFILE!=='base')for(const [encode,decode] of [['lz4Compress','lz4Decompress'],['bzip2Compress','bzip2Decompress']]) {
        const zipped=await promisify(compression[encode])('worker-extension');extensions&&=(await promisify(compression[decode])(zipped)).toString()==='worker-extension';
    }
    os.Worker.parent.onmessage=null;os.Worker.parent.postMessage({text,keyLength:key.length,decoded,extensions});
};
