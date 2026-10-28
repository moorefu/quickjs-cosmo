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
    const paths=[['.',process.cwd()],[file,file],[unicode,unicode],[path.join(root,'linked','identity.txt'),file]];
    if(process.platform==='win32'){
        paths.push([root,root],[root.replace(/\\/g,'/'),root],['/'+root[0]+root.slice(2).replace(/\\/g,'/'),root],
            [root[0]+':\\',root[0]+':\\'],['/'+root[0],root[0]+':\\'],['/'+root[0]+'/',root[0]+':\\'],
            ['\\\\?\\'+root,root]);
    }
    const output={paths:[],errors:[],files:[]};
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
        output.files.push({name,text});
    }
    return output;
}
