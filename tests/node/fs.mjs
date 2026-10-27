import fs, * as namespace from 'node:fs';
import * as alias from 'fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { check, result, errorOf } from './fixtures/result.mjs';

const cwd=process.cwd(), root=fs.mkdtempSync(path.join(cwd,'.fs-case-'));
check(path.dirname(root)===cwd,'Fixture must stay inside its own scratch directory');
const file=path.join(root,'中文 😀 bytes.bin'), observations={};
const error = call => {
    try { call(); return null; } catch (e) {
        return {name:e.name,code:e.code??null,errno:e.errno??null,syscall:e.syscall??null,
            path:typeof e.path==='string'?e.path.replaceAll(root,'ROOT'):e.path??null,
            dest:typeof e.dest==='string'?e.dest.replaceAll(root,'ROOT'):e.dest??null};
    }
};
try {
    observations.identity=fs.readFileSync===namespace.readFileSync && namespace.readFileSync===alias.readFileSync;
    observations.exists=[fs.existsSync(file),fs.existsSync({}),fs.existsSync('\0')];
    fs.writeFileSync(Buffer.from(file),'中文😀\0A','utf8');
    observations.bytes=[fs.readFileSync(file).toString('hex'),fs.readFileSync(Buffer.from(file),'utf8')];
    fs.appendFileSync(file,'ff00','hex');
    observations.append=fs.readFileSync(file).toString('hex');
    const backing=new Uint8Array([99,1,2,3,88]);
    fs.writeFileSync(file,new DataView(backing.buffer,1,3),{flush:true});
    observations.views=fs.readFileSync(file).toString('hex');
    observations.noReturn=fs.appendFileSync(file,new Uint16Array([0x0405]))===undefined;
    const number=fs.openSync(file,'r+');
    try {
        const buffer=Buffer.alloc(10,0xaa);
        const read=fs.readSync(number,new DataView(buffer.buffer,2,5),{offset:1,length:2,position:1n});
        observations.readView=[read,buffer.toString('hex')];
        observations.cursor=[fs.readSync(number,buffer,0,1),buffer[0],fs.readSync(number,buffer,0,1),buffer[0]];
        observations.writeView=fs.writeSync(number,new Uint16Array([0x0908,0x0706]),{offset:1,length:2,position:1});
        observations.writeString=fs.writeSync(number,'好',0,'utf8');
        fs.fsyncSync(number);
        fs.ftruncateSync(number,4);
        const s=fs.fstatSync(number), big=fs.fstatSync(number,{bigint:true});
        observations.stats={size:s.size,file:s.isFile(),directory:s.isDirectory(),fifo:s.isFIFO(),socket:s.isSocket(),
            block:s.isBlockDevice(),char:s.isCharacterDevice(),link:s.isSymbolicLink(),instance:s instanceof fs.Stats,
            dates:[s.atime,s.mtime,s.ctime,s.birthtime].every(d=>d instanceof Date && Number.isFinite(+d)),
            types:[typeof big.size,typeof big.ino,typeof big.mtimeNs,typeof big.mtimeMs],
            ns:big.mtimeNs/1000000n===big.mtimeMs,bigInstance:big instanceof fs.Stats,
            uid:s.uid,gid:s.gid,permissions:s.mode&0o777,dateRounding:+s.mtime===Math.round(s.mtimeMs)};
        observations.fdRead=fs.readFileSync(number).toString('hex');
        fs.writeFileSync(number,Buffer.from([0x11]));
        observations.fdStillOpen=fs.fstatSync(number).isFile();
        observations.readZero=fs.readSync(-1,Buffer.alloc(0));
        observations.largeOffset=fs.readSync(number,buffer,{length:1,position:4294967303n});
    } finally { fs.closeSync(number); }
    observations.content=fs.readFileSync(file).toString('hex');
    const provided=new Uint8Array(24).fill(0xcc);
    const returned=fs.readFileSync(file,{buffer:new DataView(provided.buffer,2,20)});
    observations.provided=[returned.toString('hex'),returned.buffer===provided.buffer,returned.byteOffset,provided[0],provided[23]];
    let requested;
    observations.allocator=fs.readFileSync(file,{buffer:size=>{requested=size;return Buffer.alloc(size+2);}}).toString('hex');
    observations.requested=requested;
    observations.tooSmall=errorOf(()=>fs.readFileSync(file,{buffer:Buffer.alloc(1)}));
    const nested=path.join(root,'a','b');
    observations.mkdir=fs.mkdirSync(nested,{recursive:true}).replace(root,'ROOT');
    observations.mkdirAgain=fs.mkdirSync(nested,{recursive:true})===undefined;
    observations.relativeMkdir=fs.mkdirSync(path.relative(cwd,path.join(root,'relative','child')),{recursive:true}).replaceAll(root,'ROOT').replaceAll(path.basename(root),'ROOT');
    fs.writeFileSync(path.join(nested,'leaf'),'leaf'); fs.mkdirSync(path.join(root,'empty'));
    observations.dir=fs.readdirSync(root).sort();
    observations.dirBuffer=fs.readdirSync(Buffer.from(root),{encoding:'buffer'}).map(b=>[Buffer.isBuffer(b),b.toString()]);
    observations.dirents=fs.readdirSync(root,{withFileTypes:true}).map(d=>[d.name,d.isFile(),d.isDirectory(),d.isSymbolicLink(),d instanceof fs.Dirent,d.parentPath===root]);
    observations.recursive=fs.readdirSync(root,{recursive:true}).sort();
    observations.recursiveDirents=fs.readdirSync(root,{recursive:true,withFileTypes:true}).map(d=>[d.name,path.relative(root,d.parentPath),d.isDirectory()]);
    const copied=path.join(root,'copy'); fs.copyFileSync(file,copied); fs.copyFileSync(copied,copied);
    observations.copy=fs.readFileSync(copied).toString('hex');
    observations.copyExcl=error(()=>fs.copyFileSync(file,copied,fs.constants.COPYFILE_EXCL));
    const renamed=path.join(root,'renamed'); fs.renameSync(copied,renamed);
    observations.rename=[fs.existsSync(copied),fs.existsSync(renamed)];
    fs.accessSync(file,fs.constants.R_OK); fs.unlinkSync(renamed); fs.rmdirSync(path.join(root,'empty'));
    observations.realpath=[fs.realpathSync(file)===path.join(fs.realpathSync(root),path.basename(file)),
        fs.realpathSync.native(file)===fs.realpathSync(file),Buffer.isBuffer(fs.realpathSync(file,'buffer'))];
    observations.lstat=fs.lstatSync(file).isFile();
    observations.statObjectKeys=Object.keys(fs.statSync(file));
    observations.constructed=[new fs.Stats(0,0x8000,1,0,0,0,4096,1,2,1,1.6,2.4,3.5,4.6).mtime.valueOf(),
        new fs.Dirent('file',1,root).isFile(),new fs.Dirent('dir',2,root).isDirectory()];
    observations.noEntry=[fs.statSync(path.join(root,'absent'),{throwIfNoEntry:false})===undefined,
        error(()=>fs.lstatSync(path.join(file,'absent'),{throwIfNoEntry:false}))];
    observations.errors={missing:error(()=>fs.readFileSync(path.join(root,'absent'))),directory:error(()=>fs.readFileSync(root)),
        deniedParent:error(()=>fs.openSync(path.join(file,'child'),'w')),badFd:error(()=>fs.fstatSync(0x7fffffff)),
        rename:error(()=>fs.renameSync(path.join(root,'none'),path.join(root,'dest'))),
        nonEmpty:error(()=>fs.rmdirSync(path.join(root,'a'))),rmDirectory:error(()=>fs.rmSync(path.join(root,'a'))),
        copyMissing:error(()=>fs.copyFileSync(path.join(root,'none'),path.join(root,'dest')))};
    observations.validation=[errorOf(()=>fs.openSync(file,'bad')),errorOf(()=>fs.readFileSync(file,'bad')),
        errorOf(()=>fs.writeFileSync(file,{})),errorOf(()=>fs.openSync('a\0b')),
        errorOf(()=>fs.openSync(Buffer.from([97,0,98]))),errorOf(()=>fs.readSync(3,new Uint8Array(2),0,3,0)),
        errorOf(()=>fs.writeSync(3,new Uint8Array(2),3,0)),errorOf(()=>fs.openSync(file,'r',-1)),
        errorOf(()=>fs.mkdirSync(nested,{recursive:1})),errorOf(()=>fs.rmSync(nested,{force:1})),
        errorOf(()=>fs.readFileSync(file,{buffer:()=>undefined}))];
    observations.constants=['O_RDONLY','O_WRONLY','O_RDWR','O_CREAT','O_EXCL','O_TRUNC','O_APPEND','F_OK','R_OK','W_OK','X_OK',
        'O_DIRECTORY','O_NOFOLLOW','O_NOCTTY','O_NONBLOCK','O_DSYNC','O_SYNC',
        'COPYFILE_EXCL','COPYFILE_FICLONE','COPYFILE_FICLONE_FORCE'].map(key=>[key,fs.constants[key]]);
    fs.rmSync(path.join(root,'a'),{recursive:true}); fs.rmSync(path.join(root,'absent'),{force:true});
    observations.removed=!fs.existsSync(path.join(root,'a'));
} finally {
    check(path.dirname(root)===cwd && path.basename(root).startsWith('.fs-case-'),'Safe fixture cleanup');
    fs.rmSync(root,{recursive:true,force:true});
}
result(observations);
