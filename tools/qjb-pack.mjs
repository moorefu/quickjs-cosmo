import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';

const MAX=64*1024*1024, MEMBER=8*1024*1024, CHUNK=64*1024;
let temporary, outputFD, ownsTemporary=false;
function check(ok,message) { if(!ok)throw new Error(message); }
function validName(name) {
    const bytes=Buffer.from(name);
    return bytes.length>0&&bytes.length<=1024&&!/[\\:\x00-\x1f\x7f]/.test(name)&&
        !name.startsWith('/')&&name.replace(/\/$/,'').split('/').every(p=>p&&p!=='.'&&p!=='..');
}
function manifestCheck(manifest,files) {
    check(manifest&&manifest.format==='qjb'&&manifest.formatVersion===1,'Expected QJB v1 manifest');
    check(typeof manifest.entry==='string'&&validName(manifest.entry)&&!manifest.entry.endsWith('/'),'Invalid entry');
    check(manifest.type===undefined||manifest.type==='module'||manifest.type==='script','Invalid entry type');
    check(!manifest.entry.endsWith('.mjs')||manifest.type!=='script','.mjs requires module mode');
    check(files.some(f=>f.name===manifest.entry&&!f.directory),'Entry does not exist');
}
try {
    const args=process.argv.slice(2);
    check(args.length>=3,'Usage: qjs tools/qjb-pack.mjs INPUT -o OUTPUT [--deflate]');
    const source=fs.realpathSync(args.shift());
    check(fs.statSync(source).isDirectory(),'INPUT must be a directory');
    let output, compressed=false;
    while(args.length) {
        const option=args.shift();
        if(option==='-o') {check(!output&&args.length,'One output filename is required');output=path.resolve(args.shift());}
        else if(option==='--deflate')compressed=true;
        else throw new Error('Unknown argument: '+option);
    }
    check(output,'Output filename is required');
    temporary=output+'.qjb-tmp-'+process.pid;
    const key=p=>process.platform==='win32'?p.toLowerCase():p;
    const excluded=new Set([key(output),key(temporary)]),files=[];
    let total=0,names=0;
    function collect(folder,prefix='') {
        for(const child of fs.readdirSync(folder)) {
            const host=path.join(folder,child);
            if(excluded.has(key(host)))continue;
            const st=fs.lstatSync(host),directory=st.isDirectory();
            check(!st.isSymbolicLink()&&(directory||st.isFile()),'Links and special files are unsupported: '+host);
            const name=prefix+child+(directory?'/':'');
            check(validName(name),'Invalid archive path: '+name);
            const size=directory?0:st.size;
            total+=size;names+=Buffer.byteLength(name);
            check(size<=MEMBER&&total<=MAX&&names<=1024*1024&&files.length<4096,'QJB resource limit exceeded');
            files.push({host,name,size,directory});
            if(directory)collect(host,name);
        }
    }
    collect(source);
    files.sort((a,b)=>Buffer.compare(Buffer.from(a.name),Buffer.from(b.name)));
    const manifestFile=files.find(f=>f.name==='bundle.json');
    check(manifestFile&&!manifestFile.directory&&manifestFile.size<=64*1024,'Missing or oversized bundle.json');
    // Re-encoding detects replacement of malformed UTF-8 in this API's decoder.
    const manifestBytes=fs.readFileSync(manifestFile.host),manifestText=manifestBytes.toString('utf8');
    check(Buffer.from(manifestText).equals(manifestBytes),'Manifest must be valid UTF-8');
    manifestCheck(JSON.parse(manifestText),files);
    outputFD=fs.openSync(temporary,'wx');
    ownsTemporary=true;
    let position=0;
    const central=[];
    function write(bytes) {
        check(position+bytes.length<=MAX,'Archive snapshot limit exceeded');
        for(let offset=0;offset<bytes.length;) {
            const n=fs.writeSync(outputFD,bytes,offset,Math.min(CHUNK,bytes.length-offset),null);
            check(n>0,'Cannot write output');offset+=n;position+=n;
        }
    }
    function scan(file,consume) {
        const fd=fs.openSync(file.host,'r'),buffer=Buffer.alloc(CHUNK);
        let size=0,crc=0;
        try {
            for(;;) {
                const n=fs.readSync(fd,buffer,0,buffer.length,null);
                if(!n)break;
                size+=n;check(size<=file.size,'Source changed during packaging');
                const part=buffer.subarray(0,n);crc=crc32(part,crc);consume?.(part,size-n);
            }
            check(size===file.size,'Source changed during packaging');
            return crc>>>0;
        } finally {fs.closeSync(fd);}
    }
    for(const file of files) {
        const name=Buffer.from(file.name),local=Buffer.alloc(30),header=Buffer.alloc(46),offset=position;
        let crc=0,packed=file.size,method=0,data;
        if(!file.directory) {
            if(compressed) {
                const input=Buffer.alloc(file.size);
                crc=scan(file,(part,offset)=>part.copy(input,offset));
                data=deflateRawSync(input);packed=data.length;method=8;
            } else crc=scan(file);
        }
        local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
        local.writeUInt16LE(method,8);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);
        local.writeUInt32LE(packed,18);local.writeUInt32LE(file.size,22);local.writeUInt16LE(name.length,26);
        write(local);write(name);
        if(data)write(data);
        else if(!file.directory)check(scan(file,part=>write(part))===crc,'Source changed during packaging');
        header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(3*256+20,4);header.writeUInt16LE(20,6);
        header.writeUInt16LE(0x800,8);header.writeUInt16LE(method,10);header.writeUInt16LE(0x21,14);
        header.writeUInt32LE(crc,16);header.writeUInt32LE(packed,20);header.writeUInt32LE(file.size,24);
        header.writeUInt16LE(name.length,28);header.writeUInt32LE(((file.directory?0o40755:0o100644)*65536+(file.directory?16:0))>>>0,38);
        header.writeUInt32LE(offset,42);central.push(header,name);
    }
    const cd=position;
    for(const part of central)write(part);
    const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
    end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
    end.writeUInt32LE(position-cd,12);end.writeUInt32LE(cd,16);write(end);
    fs.fsyncSync(outputFD);fs.closeSync(outputFD);outputFD=undefined;
    fs.renameSync(temporary,output);temporary=undefined;
    console.log(JSON.stringify({format:'qjb',formatVersion:1,members:files.length,bytes:position,output}));
} catch(error) {
    console.error('qjb-pack:',error.message);process.exitCode=1;
} finally {
    if(outputFD!==undefined)try{fs.closeSync(outputFD);}catch{}
    if(temporary&&ownsTemporary)try{fs.unlinkSync(temporary);}catch{}
}
