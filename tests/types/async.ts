import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import compression from 'cosmo:compression';
import type {Buffer} from 'node:buffer';
async function check() {
    const same:typeof fsp=fs.promises;
    const data:Buffer=await same.readFile('file');
    const text:string=await fsp.readFile('file','utf8');
    const handle=await fsp.open('file','r+');
    const result=await handle.read({length:10});const buffer:Buffer=result.buffer;
    const view=await handle.read(new DataView(new ArrayBuffer(10)),{length:2});const dataView:DataView=view.buffer;
    await handle.write('text',0,'utf8');await handle.stat({bigint:true});await handle.sync();await handle.close();
    await handle[Symbol.asyncDispose]();
    fs.readFile('file','utf8',(error,value)=>{if(error)throw error;const answer:string=value;void answer;});
    fs.read(1,new Uint8Array(10),0,10,0,(error,count,value)=>{if(error)throw error;const answer:Uint8Array=value;void [count,answer];});
    crypto.pbkdf2('p','s',100,32,'sha256',(error,key)=>{if(error)throw error;const answer:Buffer=key;void answer;});
    crypto.hkdf('sha256','p','s','i',32,(error,key)=>{if(error)throw error;const answer:ArrayBuffer=key;void answer;});
    crypto.randomFill(new DataView(new ArrayBuffer(10)),1,2,(error,value)=>{if(error)throw error;const answer:DataView=value;void answer;});
    zlib.gzip('text',{level:9,signal:new AbortController().signal},(error,value)=>{if(error)throw error;const answer:Buffer=value;void answer;});
    // @ts-expect-error Promise paths do not accept integer file descriptors.
    await fsp.readFile(1);
    // @ts-expect-error callbacks are required for callback zlib methods.
    zlib.gzip(data);
    // @ts-expect-error read result retains its DataView type.
    const wrong:Buffer=dataView;
    // @ts-expect-error crypto callback has an ArrayBuffer result for hkdf.
    crypto.hkdf('sha256','p','s','i',32,(error,key:Buffer)=>{});
    void [buffer,text];
}
void check;
