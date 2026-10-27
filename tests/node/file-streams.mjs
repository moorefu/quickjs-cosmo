import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {Readable,Writable} from 'node:stream';
import {pipeline,finished} from 'node:stream/promises';
import {check,result} from './fixtures/result.mjs';
const root=fs.mkdtempSync(path.join(process.cwd(),'.file-streams-')),file=path.join(root,'in'),zipped=path.join(root,'gzip'),restored=path.join(root,'out');
const output={},data=Buffer.from('文件😀\0abc'.repeat(18000));fs.writeFileSync(file,data);
async function collect(stream){const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
try {
    const r=fs.createReadStream(file,{highWaterMark:1021}),w=fs.createWriteStream(zipped,{highWaterMark:89}),events=[];
    r.on('open',()=>events.push('open'));r.on('ready',()=>events.push('ready'));r.on('end',()=>events.push('end'));r.on('close',()=>events.push('close'));
    output.identity=[r instanceof fs.ReadStream,r instanceof Readable,w instanceof fs.WriteStream,w instanceof Writable,r.pending,r.fd===null];
    await pipeline(r,zlib.createGzip(),w);
    await pipeline(fs.createReadStream(zipped,{highWaterMark:37}),zlib.createGunzip(),fs.createWriteStream(restored,{flush:true}));
    check(fs.readFileSync(restored).equals(data),'file-compression-file roundtrip');
    output.pipeline=[r.bytesRead===data.length,w.bytesWritten===fs.statSync(zipped).size,r.closed,w.closed,r.fd,w.fd,events];
    output.range=(await collect(fs.createReadStream(file,{start:3,end:33,highWaterMark:2}))).toString('hex');
    output.endOnly=(await collect(fs.createReadStream(file,{end:4}))).toString('hex');
    const hash=crypto.createHash('sha256'),parts=[];hash.on('data',c=>parts.push(c));await pipeline(fs.createReadStream(file),hash);
    output.digest=Buffer.concat(parts).toString('hex')===crypto.createHash('sha256').update(data).digest('hex');
    const fd=fs.openSync(file,'r');const supplied=fs.createReadStream(undefined,{fd,autoClose:false,start:1,end:4});
    output.fdContent=(await collect(supplied)).toString('hex');output.fdStillOpen=fs.fstatSync(fd).isFile();
    const suppliedClosed=new Promise(resolve=>supplied.once('close',resolve));supplied.close();await suppliedClosed;
    try{fs.fstatSync(fd);output.fdClosed=false;}catch(e){output.fdClosed=e.code==='EBADF';}
    const target=path.join(root,'position');fs.writeFileSync(target,'0123456789');
    const position=fs.createWriteStream(target,{flags:'r+',start:3,highWaterMark:1});position.end('XY');await finished(position);
    output.position=[fs.readFileSync(target,'utf8'),position.bytesWritten];
    const retainedFd=fs.openSync(target,'a'),retained=fs.createWriteStream(undefined,{fd:retainedFd,autoClose:false});retained.end('Z');await finished(retained);
    output.writeRetained=fs.fstatSync(retainedFd).isFile();
    const retainedClosed=new Promise(resolve=>retained.once('close',resolve));retained.destroy();await retainedClosed;
    try{fs.fstatSync(retainedFd);output.writeClosed=false;}catch(e){output.writeClosed=e.code==='EBADF';}
    const destroyFd=fs.openSync(file,'r'),explicit=fs.createReadStream(undefined,{fd:destroyFd,autoClose:false});
    const explicitlyClosed=new Promise(resolve=>explicit.once('close',resolve));explicit.destroy();await explicitlyClosed;
    try{fs.fstatSync(destroyFd);output.explicitDestroy=false;}catch(e){output.explicitDestroy=e.code==='EBADF';}
    const closingFile=path.join(root,'close-write'),closing=fs.createWriteStream(closingFile,{autoClose:false});closing.write('close-content');
    const writeClosed=new Promise(resolve=>closing.once('close',resolve));closing.close();await writeClosed;output.writeClose=fs.readFileSync(closingFile,'utf8');
    const premature=fs.createReadStream(file);output.closeBeforeEnd=await new Promise(resolve=>premature.close(e=>resolve(e?.code??null)));
    const missing=fs.createReadStream(path.join(root,'absent'));const errors=[];missing.on('error',e=>errors.push(e.code));missing.on('close',()=>errors.push('close'));
    try{await finished(missing);}catch{}await new Promise(resolve=>setTimeout(resolve,1));output.missing=errors;
    const abort=new AbortController(),aborted=fs.createReadStream(file,{signal:abort.signal});const failure=finished(aborted).catch(e=>e.code);abort.abort();output.abort=await failure;
    const h=await fsp.open(file,'r');const hr=fs.createReadStream(undefined,{fd:h,autoClose:false,start:0,end:3});
    output.fileHandle=(await collect(hr)).toString('hex');await h.close();
    const custom={...fs,read(fd,buffer,offset,length,position,callback){fs.read(fd,buffer,offset,Math.min(length,7),position,callback);},write(fd,buffer,offset,length,position,callback){fs.write(fd,buffer,offset,Math.min(length,3),position,callback);}};
    const short=path.join(root,'short');await pipeline(fs.createReadStream(file,{fs:custom,start:0,end:192}),fs.createWriteStream(short,{fs:custom}));output.partial=fs.readFileSync(short).equals(data.subarray(0,193));
    for(const operation of ['read','write']) {
        let closed=0;const injected={...fs,close(fd,cb){closed++;fs.close(fd,cb);},[operation](...args){const error=Error('injected file IO failure');error.code='EIO';queueMicrotask(()=>args[args.length-1](error));}};
        const stream=operation==='read'?fs.createReadStream(file,{fs:injected}):fs.createWriteStream(path.join(root,'failed-write'),{fs:injected});
        try{if(operation==='read')await pipeline(stream,new Writable({write(c,e,cb){cb();}}));else await pipeline(Readable.from(['fail']),stream);}catch(e){output[operation+'Failure']=[e.code,stream.closed,closed===1];}
    }
} finally {fs.rmSync(root,{recursive:true,force:true});}
result(output);
