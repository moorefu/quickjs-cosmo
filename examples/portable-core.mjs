import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,gunzipSync} from 'node:zlib';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {execFileSync} from 'node:child_process';

if(process.argv[2]==='--portable-child')console.log('portable-child');
else {
const message=Buffer.from('Node-compatible ESM on QuickJS\n');
const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'quickjs-example-'));
try {
    const file=path.join(directory,'message.gz');
    await pipeline(Readable.from([message]),createGzip(),fs.createWriteStream(file));
    assert.equal(gunzipSync(await fsp.readFile(file)).equals(message),true);

    const key=randomBytes(32),iv=randomBytes(12),aad=Buffer.from('portable-example');
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
    const encrypted=Buffer.concat([cipher.update(message),cipher.final()]);
    const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad);decipher.setAuthTag(cipher.getAuthTag());
    assert.equal(Buffer.concat([decipher.update(encrypted),decipher.final()]).equals(message),true);

    const childArgs=process.argv[1]===process.execPath?['--portable-child']:[process.argv[1],'--portable-child'];
    const child=execFileSync(process.execPath,childArgs).toString().trim();
    assert.equal(child,'portable-child');
    console.log(JSON.stringify({example:'core',bytes:message.length,sha256:createHash('sha256').update(message).digest('hex'),compression:true,encryption:true,child}));
} finally {
    await fsp.rm(directory,{recursive:true,force:true});
}
}
