import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { check, errorOf, result } from './fixtures/result.mjs';
const cwd=process.cwd(),root=fs.mkdtempSync(path.join(cwd,'.fs-edge-'));
check(path.dirname(root)===cwd,'Safe fixture root');
const file=path.join(root,'bytes'), out={};
const capture=call=>{try{return {value:call()};}catch(e){return {error:{name:e.name,code:e.code??null,syscall:e.syscall??null,errno:e.errno??null}};}};
try {
    fs.writeFileSync(file,'0123456789');
    const fd=fs.openSync(file,'r+');
    try {
        const operations=[
            ()=>fs.readSync(fd,Buffer.alloc(4)),
            ()=>fs.readSync(fd,Buffer.alloc(4),null),
            ()=>fs.readSync(fd,Buffer.alloc(4),{}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{offset:2}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{offset:99,length:0}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{length:1,position:-1n}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{length:1,position:1.5}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{length:-1}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{length:'2',position:0}),
            ()=>fs.readSync(fd,Buffer.alloc(4),{length:0,position:2n**63n}),
            ()=>fs.readSync(fd,new ArrayBuffer(4)),
            ()=>fs.writeSync(fd,Buffer.alloc(0)),
            ()=>fs.writeSync(fd,Buffer.from('hi'),null),
            ()=>fs.writeSync(fd,Buffer.from('hi'),{position:0n}),
            ()=>fs.writeSync(fd,Buffer.from('hi'),{length:1.5}),
            ()=>fs.writeSync(fd,'ok',null,'utf8'),
            ()=>fs.writeSync(fd,'ok',0n,'utf8'),
            ()=>fs.writeSync(fd,'ok',1.5,'utf8'),
            ()=>fs.writeSync(fd,'abc',0,'hex'),
            ()=>fs.writeSync(fd,'ab',0,'hex'),
            ()=>fs.writeSync(fd,'abc',0,'bad'),
            ()=>fs.writeSync(fd,Buffer.from('hi'),{position:1.5}),
            ()=>fs.writeSync(fd,new ArrayBuffer(4)),
        ];
        out.overloads=operations.map(fn=>capture(fn));
        out.truncate= capture(()=>{fs.ftruncateSync(fd,-1);return fs.fstatSync(fd).size;});
    } finally { fs.closeSync(fd); }
    out.options=[
        ()=>fs.readFileSync(file,13), ()=>fs.writeFileSync(file,'a',{flush:1}),
        ()=>fs.readdirSync(root,{recursive:1}),()=>fs.statSync(file,null),
        ()=>fs.mkdirSync(path.join(root,'mode'),'888'),()=>fs.copyFileSync(file,file,8),
        ()=>fs.accessSync(file,8),()=>fs.readFileSync(file,{buffer:()=>({})}),
    ].map(fn=>capture(()=>{const value=fn();return value===undefined?'undefined':value instanceof fs.Stats?'Stats':value;}));
    fs.writeFileSync(file,'abc');
    out.flags=[];
    for (const flag of ['r','rs','sr','r+','rs+','sr+','w','w+','wx','xw','wx+','xw+','a','a+','ax','xa','ax+','xa+','as','sa','as+','sa+']) {
        out.flags.push([flag,capture(()=>{const n=fs.openSync(file,flag);fs.closeSync(n);return true;})]);
    }
    const numeric=path.join(root,'numeric');
    fs.writeFileSync(numeric,Buffer.from([1,2]),{flag:fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL});
    out.numeric=fs.readFileSync(numeric).toString('hex');
    out.accessModes=[fs.constants.F_OK,fs.constants.R_OK,fs.constants.W_OK,fs.constants.X_OK].map(m=>capture(()=>fs.accessSync(numeric,m)));
    const shared=new SharedArrayBuffer(8), sharedView=new DataView(shared,2,4), sharedFd=fs.openSync(numeric,'r');
    try { out.shared=[fs.readSync(sharedFd,sharedView,{length:2,position:0}),Array.from(new Uint8Array(shared))]; }
    finally { fs.closeSync(sharedFd); }
    if (typeof ArrayBuffer.prototype.transfer==='function') {
        const detached=new Uint8Array(4);detached.buffer.transfer();
        const number=fs.openSync(numeric,'r+');
        try {out.detached=[capture(()=>fs.readSync(number,detached)),capture(()=>fs.writeSync(number,detached))];}
        finally {fs.closeSync(number);}
    }
    out.readOnlyTruncate=capture(()=>{const n=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_TRUNC);fs.closeSync(n);return fs.statSync(file).size;});
    out.invalidPaths=[{},new Uint8Array([97]),17,null,undefined].map(value=>capture(()=>fs.accessSync(value)));
    out.emptyPath=[capture(()=>fs.openSync('')),capture(()=>fs.readdirSync(''))];
    out.descriptorErrors=[];
    for (const number of [-1,1.5,NaN,2147483647,4294967295]) for (const enc of [undefined,'utf8']) {
        out.descriptorErrors.push(capture(()=>fs.readFileSync(number,enc)));
        out.descriptorErrors.push(capture(()=>fs.writeFileSync(number,'x',enc)));
    }
    out.recursiveByteOptions=[capture(()=>fs.readdirSync(root,{recursive:true,encoding:'buffer'})),
        capture(()=>fs.readdirSync(Buffer.from(root),{recursive:true,withFileTypes:true}))];
    out.directories=[capture(()=>fs.unlinkSync(root)),capture(()=>fs.rmdirSync(file)),capture(()=>fs.rmSync(file,{recursive:true}))];
    fs.mkdirSync(path.join(root,'copydir'));
    out.copyDirectory=capture(()=>fs.copyFileSync(path.join(root,'copydir'),path.join(root,'other')));
    // Existing contents survive an exclusive copy failure and same-file copy.
    fs.writeFileSync(file,'retained');
    out.exclusive=capture(()=>fs.copyFileSync(numeric,file,fs.constants.COPYFILE_EXCL));
    fs.copyFileSync(file,file);
    out.retained=fs.readFileSync(file,'utf8');
    const temporary=fs.mkdtempSync(Buffer.from(path.join(root,'temp-')),{encoding:'buffer'});
    out.temporary=[Buffer.isBuffer(temporary),fs.statSync(temporary).isDirectory()]; fs.rmdirSync(temporary);
    if (process.platform!=='win32') {
        const invalid=Buffer.concat([Buffer.from(root+'/'),Buffer.from([0xff,0xfe])]);
        out.raw=capture(()=>{ fs.writeFileSync(invalid,Buffer.from([1,2,3]));
            const value=[fs.readFileSync(invalid).toString('hex'),fs.readdirSync(root,{encoding:'buffer'}).some(b=>b.equals(Buffer.from([0xff,0xfe])))];
            fs.unlinkSync(invalid); return value; });
        // Setup uses the existing host symlink primitive; the observations use
        // only the newly implemented Node-facing fs operations.
        const host=typeof fs.symlinkSync==='function'?null:await import('qjs:os');
        const link=(target,name)=>{ if (host) { if (host.symlink(target,name)!==0) throw Error('Host symlink setup'); } else fs.symlinkSync(target,name); };
        const fileLink=path.join(root,'link-file'), dirLink=path.join(root,'link-dir'), broken=path.join(root,'link-broken');
        fs.writeFileSync(path.join(root,'copydir','keep'),'keep');
        link(file,fileLink);link(path.join(root,'copydir'),dirLink);link(path.join(root,'none'),broken);
        out.links=[fs.statSync(fileLink).isFile(),fs.lstatSync(fileLink).isSymbolicLink(),
            fs.lstatSync(broken).isSymbolicLink(),fs.existsSync(broken),
            fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.name.startsWith('link-')).map(d=>[d.name,d.isSymbolicLink(),d.isDirectory()])];
        out.noFollow=capture(()=>{const n=fs.openSync(fileLink,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);fs.closeSync(n);return true;});
        out.linkTraversal=fs.readdirSync(root,{recursive:true}).filter(n=>n.startsWith('link-dir')).sort();
        fs.rmSync(dirLink,{recursive:true});out.linkRemoval=fs.readFileSync(path.join(root,'copydir','keep'),'utf8');
    }
} finally {
    check(path.dirname(root)===cwd&&path.basename(root).startsWith('.fs-edge-'),'Safe cleanup');
    fs.rmSync(root,{recursive:true,force:true});
}
result(out);
