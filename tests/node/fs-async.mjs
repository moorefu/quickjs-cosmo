import fs from 'node:fs';
import fsp from 'node:fs/promises';
import bare from 'fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {check,result} from './fixtures/result.mjs';
const root=fs.mkdtempSync(path.join(process.cwd(),'.async-fs-')),file=path.join(root,'file');
const output={identity:fsp===fs.promises&&bare===fsp};
function call(name,...args){return new Promise((resolve,reject)=>fs[name](...args,(error,...value)=>error?reject(error):resolve(value)));}
async function errorOf(fn){try{await fn();return null;}catch(e){return {name:e.name,code:e.code,syscall:e.syscall??null,errno:e.errno??null};}}
try {
    output.write=await call('writeFile',file,'中文😀',{encoding:'utf8',flush:true});
    output.read=await call('readFile',file,'utf8');
    await fsp.appendFile(file,'tail');output.promisesRead=(await fsp.readFile(file)).toString();
    let synchronous=true;
    const order=new Promise((resolve,reject)=>fs.stat(file,(error,value)=>{if(error)return reject(error);output.asyncCallback=!synchronous;output.stat=[value.isFile(),typeof value.size];resolve();}));
    synchronous=false;await order;
    const number=(await call('open',file,'r+'))[0];
    try {
        const data=new Uint8Array(20),r=await call('read',number,new DataView(data.buffer,2,12),{offset:1,length:5,position:0});
        output.readView={count:r[0],view:r[1] instanceof DataView,bytes:Buffer.from(data).toString('hex')};
        const w=await call('write',number,'OK',0,'utf8');output.writeString=[w[0],w[1]];
        const p=await promisify(fs.read)(number,Buffer.alloc(3),0,3,0);output.promisify=[Object.keys(p).sort(),p.bytesRead,p.buffer.toString('hex')];
        output.fstat=(await call('fstat',number,{bigint:true}))[0].isFile();
        await call('ftruncate',number,5);await call('fsync',number);
    } finally {await call('close',number);}
    const handle=await fsp.open(file,'w+');
    output.handleType=handle.constructor.name;
    const writes=[handle.write(Buffer.from('abc'),0,3,0),handle.write('def',3,'utf8')];
    const closing=handle.close();output.sameClose=closing===handle.close();
    output.handleWrites=(await Promise.all(writes)).map(x=>[x.bytesWritten,typeof x.buffer]);
    await closing;output.closedFd=handle.fd;output.closed=await errorOf(()=>handle.read(Buffer.alloc(1),0,1,0));
    output.handleContent=await fsp.readFile(file,'utf8');
    const h=await fsp.open(file,'r');
    try {const {bytesRead,buffer}=await h.read({length:2,position:1});output.handleRead=[bytesRead,Buffer.isBuffer(buffer),buffer.subarray(0,bytesRead).toString()];output.handleStat=(await h.stat()).isFile();output.readonlySync=await errorOf(()=>h.sync());}
    finally {await h.close();}
    const extra=await fsp.open(path.join(root,'handle-extra'),'w+');
    await extra.writeFile('file-data');await extra.appendFile('-tail');await extra.truncate(4);
    const extraRead=await extra.read(Buffer.alloc(4),0,4,0);output.handleMethods=[extraRead.buffer.toString(),(await extra.stat()).size];
    const extraClose=extra.close();output.fdDuringClose=extra.fd;await extraClose;await extra[Symbol.asyncDispose]();
    const nested=path.join(root,'a','b');output.mkdir=(await fsp.mkdir(nested,{recursive:true})).endsWith(path.join(root,'a'));
    await fsp.writeFile(path.join(nested,'child'),'x');
    output.directory=(await fsp.readdir(root,{withFileTypes:true})).map(x=>[x.name,x.isDirectory(),x.parentPath===root]);
    output.recursive=(await fsp.readdir(root,{recursive:true})).sort();
    const copy=path.join(root,'copy');await fsp.copyFile(file,copy);output.copy=await fsp.readFile(copy,'utf8');
    output.exclusive=await errorOf(()=>fsp.copyFile(file,copy,fs.constants.COPYFILE_EXCL));
    await fsp.rename(copy,path.join(root,'renamed'));await fsp.unlink(path.join(root,'renamed'));
    const temp=await fsp.mkdtemp(path.join(root,'tmp'));output.temp=typeof temp==='string'&&temp.startsWith(path.join(root,'tmp'));await fsp.rmdir(temp);
    await fsp.access(file);output.lstat=(await fsp.lstat(file)).isFile();
    const relative=path.relative(process.cwd(),file);output.realpath=await fsp.realpath(relative)===file;
    output.realpathBuffer=Buffer.isBuffer(await fsp.realpath(relative,'buffer'));
    const controller=new AbortController();controller.abort('stop');output.abort=await errorOf(()=>fsp.readFile(file,{signal:controller.signal}));
    output.missing=await errorOf(()=>fsp.readFile(path.join(root,'missing')));
    output.badPromisePath=await errorOf(()=>fsp.readFile(0));
    output.badCallback=await errorOf(()=>fs.stat(file,1));
    output.badRead=await errorOf(()=>call('read',1,Buffer.alloc(2),0,3,0));
    await fsp.rm(path.join(root,'a'),{recursive:true,force:true});output.removed=!fs.existsSync(path.join(root,'a'));
    check(output.identity,'fs/promises identity');check(output.asyncCallback,'callbacks are asynchronous');
} finally {fs.rmSync(root,{recursive:true,force:true});}
result(output);
