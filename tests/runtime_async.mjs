import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import compression from 'cosmo:compression';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as os from 'os';
const root=fs.mkdtempSync(path.join(process.cwd(),'.runtime-async-'));
try {
    const file=path.join(root,'data');await fsp.writeFile(file,'async-worker-input');
    const handle=await fsp.open(file,'r');
    try{assert.equal(await fsp.readFile(handle,'utf8'),'async-worker-input');}finally{await handle.close();}
    const data=Buffer.from('async-compression-中文😀'.repeat(1000));
    for(const [encode,decode] of [['lz4Compress','lz4Decompress'],['bzip2Compress','bzip2Decompress']]) {
        const encoded=await promisify(compression[encode])(data);
        assert((await promisify(compression[decode])(encoded)).equals(data));
    }
    let ticks=0;const timer=setInterval(()=>ticks++,1);
    try {
        const [key,encoded]=await Promise.all([promisify(crypto.pbkdf2)('p','s',200000,32,'sha512'),promisify(zlib.gzip)(Buffer.alloc(4*1024*1024,97),{level:9})]);
        assert.equal(key.length,32);assert(encoded.length>0);assert(ticks>0);
    }finally{clearInterval(timer);}
    const worker=new os.Worker('./fixtures/async-worker.mjs');
    const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('async Worker timeout')),10000);
        worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;resolve(data);};worker.postMessage(file);
    });
    assert.equal(result.text,'async-worker-input');assert.equal(result.keyLength,32);assert.equal(result.decoded,'worker-compression');
    assert(result.extensions);
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS runtime-async');
