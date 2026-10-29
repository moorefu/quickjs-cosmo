import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {check,result} from './fixtures/result.mjs';
const cwd=process.cwd(),root=fs.mkdtempSync(path.join(cwd,'.junction-'));
check(path.dirname(root)===cwd,'Safe fixture root');
const oracle=process.env.NODE_COMPAT_CHILD_EXECUTABLE;
check(oracle,'Missing pinned native fixture producer');
const native=`
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(process.argv[1]);
const base=fs.realpathSync('.'),actual=fs.realpathSync(root),relative=path.relative(base,actual);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(root).startsWith('.junction-'))throw Error('Unsafe fixture root');
const entries=[['linked','real'],['联接 空格','目标 空格'],['chain','linked'],['dangling','missing']];
if(process.argv[2]==='setup'){
    for(const name of ['real','目标 空格']){fs.mkdirSync(path.join(root,name));fs.writeFileSync(path.join(root,name,'data'),'payload');}
    for(const [name,target]of entries)fs.symlinkSync(path.join(root,target),path.join(root,name),process.platform==='win32'?'junction':'dir');
    console.log(JSON.stringify(entries.map(([name])=>fs.lstatSync(path.join(root,name)).isSymbolicLink())));
}else{
    for(const [name]of entries){const link=path.join(root,name);try{if(process.platform==='win32')fs.rmdirSync(link);else fs.unlinkSync(link);}catch(e){if(e.code!=='ENOENT')throw e;}}
    fs.rmSync(actual,{recursive:true,force:true});
}`;
const invoke=mode=>{
    const child=spawnSync(oracle,['-e',native,root,mode],{encoding:'utf8',windowsHide:true,timeout:15000});
    check(child.status===0,child.stderr);return child.stdout;
};
const type=value=>[value.isSymbolicLink(),value.isFile(),value.isDirectory()];
const output={};
try{
    output.oracle=JSON.parse(invoke('setup'));
    output.links=[];
    for(const name of ['linked','联接 空格','chain','dangling']){
        const file=path.join(root,name),row={name,sync:type(fs.lstatSync(file)),promise:type(await fs.promises.lstat(file))};
        row.callback=await new Promise((resolve,reject)=>fs.lstat(file,(error,value)=>error?reject(error):resolve(type(value))));
        try{row.stat=type(fs.statSync(file));row.content=fs.readFileSync(path.join(file,'data'),'utf8');}catch(e){row.error=e.code;}
        output.links.push(row);
    }
    output.controls=[type(fs.lstatSync(path.join(root,'real'))),type(fs.lstatSync(path.join(root,'real','data')))];
}finally{invoke('cleanup');}
result(output);
