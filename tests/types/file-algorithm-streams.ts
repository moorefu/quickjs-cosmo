import fs,{ReadStream,WriteStream} from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib,{Gzip} from 'node:zlib';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const r:ReadStream=fs.createReadStream('in',{start:2,end:3,highWaterMark:64});
const w:WriteStream=fs.createWriteStream('out',{start:2,flush:true});
r.close(error=>{const received:Error|null|undefined=error;void received;});
const h:Transform=crypto.createHash('sha256');const gzip:Gzip=zlib.createGzip({flush:zlib.constants.Z_SYNC_FLUSH});
void pipeline(r,h,gzip,w);
void fsp.open('file','r').then(handle=>handle.createReadStream({autoClose:false}));
const info:Buffer=zlib.gzipSync('abc',{info:true}).buffer;void info;
// @ts-expect-error File range end is a number.
fs.createReadStream('in',{end:'3'});
// @ts-expect-error Compression flush kind is numeric, unlike Transform's hook.
zlib.createGzip({flush:()=>{}});
