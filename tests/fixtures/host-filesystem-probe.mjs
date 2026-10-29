import * as os from 'os';
import * as std from 'std';
import fs from 'node:fs';
import path from 'node:path';

export async function probe(directory){
    const trace=value=>{if(process.env.QJS_HOST_FS_TRACE)std.err.puts('HOST STEP '+value+'\n');};
    trace('start '+directory);
    const root=process.platform==='win32'?directory.replace(/^\/([A-Za-z])(?=\/|$)/,'$1:').replace(/\//g,'\\'):directory;
    fs.mkdirSync(path.join(root,'real'),{recursive:true});fs.mkdirSync(path.join(root,'中文 空格'),{recursive:true});
    const file=path.join(root,'real','identity.txt'),unicode=path.join(root,'中文 空格','value.txt');
    fs.writeFileSync(file,'identity');fs.writeFileSync(unicode,'unicode');
    const junctionFile=path.join(root,'目标 空格','identity.txt');fs.writeFileSync(junctionFile,'junction unicode');
    const paths=[['.',process.cwd()],[file,file],[unicode,unicode],[path.join(root,'linked','identity.txt'),file],
        [path.join(root,'chain','identity.txt'),file],[path.join(root,'联接 空格','identity.txt'),junctionFile]];
    if(process.platform==='win32'&&root.startsWith('\\\\')){
        paths.push([root,root],['\\\\?\\UNC\\'+root.slice(2),root]);
    }else if(process.platform==='win32'){
        paths.push([root,root],[root.replace(/\\/g,'/'),root],['/'+root[0]+root.slice(2).replace(/\\/g,'/'),root],
            [root[0]+':\\',root[0]+':\\'],['/'+root[0],root[0]+':\\'],['/'+root[0]+'/',root[0]+':\\'],
            ['\\\\?\\'+root,root],[root.toUpperCase(),root]);
    }
    const output={paths:[],errors:[],files:[],links:[]};
    const type=value=>[value.isSymbolicLink(),value.isFile(),value.isDirectory()];
    for(const [name,target,dangling]of [['linked','real',false],['联接 空格','目标 空格',false],['chain','linked',false],['dangling','missing-junction-target',true]]){
        const link=path.join(root,name),row={name:link,target:path.join(root,target),dangling,
            legacy:os.lstat(link),readlink:os.readlink(link),stat:os.stat(link),sync:type(fs.lstatSync(link)),async:type(await fs.promises.lstat(link))};
        row.callback=await new Promise((resolve,reject)=>fs.lstat(link,(error,value)=>error?reject(error):resolve(type(value))));
        try{row.syncStat=type(fs.statSync(link));}catch(e){row.syncStat=e.code;}
        try{row.asyncStat=type(await fs.promises.stat(link));}catch(e){row.asyncStat=e.code;}
        output.links.push(row);
    }
    output.controls=[type(fs.lstatSync(file)),type(await fs.promises.lstat(path.join(root,'real')))];
    fs.writeFileSync(path.join(root,'real','linked-module.mjs'),'export default "junction module";');
    output.module=(await import(path.join(root,'chain','linked-module.mjs'))).default;
    for(const [input,expected]of paths){trace('realpath '+input);const value={input,expected,legacy:os.realpath(input)};try{value.sync=fs.realpathSync(input);}catch(e){value.syncError=e.code;}try{value.async=await fs.promises.realpath(input);}catch(e){value.asyncError=e.code;}output.paths.push(value);}
    for(const [input,expected]of [[path.join(root,'missing'),'ENOENT'],[path.join(file,'child'),'ENOTDIR']]){
        trace('error '+input);
        const value={input,expected,legacy:os.realpath(input)};
        try{fs.realpathSync(input);value.sync='ACCEPTED';}catch(e){value.sync=e.code;}
        try{await fs.promises.realpath(input);value.async='ACCEPTED';}catch(e){value.async=e.code;}
        output.errors.push(value);
    }
    for(const mode of ['std','os','sync','async']){
        trace('file '+mode);
        const name=path.join(root,'.dot-'+mode),text='created by '+mode;
        if(mode==='std'){const f=std.open(name,'w');if(!f)throw Error('std.open failed');f.puts(text);f.close();}
        else if(mode==='os'){const fd=os.open(name,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600);if(fd<0)throw Error('os.open failed');const data=new TextEncoder().encode(text);let offset=0;try{while(offset<data.length){const count=os.write(fd,data.buffer,offset,data.length-offset);if(count<=0)throw Error('os.write failed');offset+=count;}}finally{os.close(fd);}}
        else if(mode==='sync')fs.writeFileSync(name,text);else await fs.promises.writeFile(name,text);
        const renamed=name+'-renamed';
        if(mode==='async'){await fs.promises.rename(name,renamed);await fs.promises.rename(renamed,name);}
        else if(mode==='sync'){fs.renameSync(name,renamed);fs.renameSync(renamed,name);}
        else{if(os.rename(name,renamed)!==0||os.rename(renamed,name)!==0)throw Error('legacy rename failed');}
        const lock=name+'-lock';let exclusive;
        if(mode==='async'){
            exclusive=await fs.promises.open(lock,'wx');
            try{await fs.promises.open(lock,'wx');throw Error('exclusive lock was overwritten');}catch(e){if(e.code!=='EEXIST')throw e;}
            await exclusive.close();await fs.promises.unlink(lock);
        }else if(mode==='sync'){
            exclusive=fs.openSync(lock,'wx');
            try{fs.openSync(lock,'wx');throw Error('exclusive lock was overwritten');}catch(e){if(e.code!=='EEXIST')throw e;}
            fs.closeSync(exclusive);fs.unlinkSync(lock);
        }else{
            exclusive=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);if(exclusive<0)throw Error('legacy exclusive create failed');
            try{const second=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);if(second>=0){os.close(second);throw Error('legacy exclusive lock was overwritten');}}finally{os.close(exclusive);os.remove(lock);}
        }
        output.files.push({name,text,renameRoundTrip:true,exclusive:true});
    }
    return output;
}
