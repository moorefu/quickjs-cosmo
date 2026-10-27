import fs from 'node:fs';
const [mode,...args]=process.argv.slice(2);
function write(fd,value){let offset=0;const data=typeof value==='string'?Buffer.from(value):value;while(offset<data.length)offset+=fs.writeSync(fd,data,offset,data.length-offset);}
if(mode==='echo') {
    write(1,JSON.stringify({args,cwd:process.cwd(),token:process.env.CHILD_TOKEN??null,path:process.env.PATH??null,argv0:process.argv0,
        pid:process.pid,uid:process.getuid?.()??null,gid:process.getgid?.()??null}));
} else if(mode==='binary') {write(1,Buffer.from([0,1,2,255]));write(2,Buffer.from([3,4,254]));}
else if(mode==='exit') {write(1,'out');write(2,'err');process.exit(Number(args[0]));}
else if(mode==='stdio') {write(1,'OUT');write(2,'ERR');}
else if(mode==='input') {
    const parts=[],buffer=Buffer.alloc(65536);let count;
    while((count=fs.readSync(0,buffer,0,buffer.length,null))>0)parts.push(Buffer.from(buffer.subarray(0,count)));
    write(1,Buffer.concat(parts));
} else if(mode==='flood') {
    const block=Buffer.alloc(65536,97);for(let i=0;i<16;i++)write(1,block);
    block.fill(98);for(let i=0;i<16;i++)write(2,block);
    const input=Buffer.alloc(65536);let count,total=0;while((count=fs.readSync(0,input,0,input.length,null))>0)total+=count;
    write(1,'INPUT='+total);
} else if(mode==='sleep') {setTimeout(()=>write(1,'late'),1000);}
else if(mode==='env') {write(1,JSON.stringify({token:process.env.CHILD_TOKEN??null,prototype:process.env.PROTOTYPE_TOKEN??null}));}
else if(mode==='argv0') {write(1,process.argv0);}
else if(mode==='signal') {process.kill(process.pid,args[0]);}
