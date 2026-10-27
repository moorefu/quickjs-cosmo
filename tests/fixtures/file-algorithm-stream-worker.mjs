import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import * as os from 'os';
os.Worker.parent.onmessage=async({data})=>{
    const root=fs.mkdtempSync(path.join(process.cwd(),'.stream-worker-'));
    let result;
    try {
        const source=path.join(root,'source'),zip=path.join(root,'zip'),target=path.join(root,'target');fs.writeFileSync(source,data);
        await pipeline(fs.createReadStream(source,{highWaterMark:3}),zlib.createGzip(),fs.createWriteStream(zip));
        await pipeline(fs.createReadStream(zip,{highWaterMark:7}),zlib.createGunzip(),fs.createWriteStream(target));
        const hash=crypto.createHash('sha256'),chunks=[];hash.on('data',c=>chunks.push(c));await pipeline(fs.createReadStream(target),hash);
        result={content:fs.readFileSync(target,'utf8'),match:Buffer.concat(chunks).equals(crypto.createHash('sha256').update(data).digest())};
    }catch(e){result={error:e.stack??String(e)};}finally{fs.rmSync(root,{recursive:true,force:true});}
    os.Worker.parent.onmessage=null;os.Worker.parent.postMessage(result);
};
