import p,{stdin,stdout,stderr} from 'node:process';import {Readable,Writable} from 'node:stream';import {pipeline} from 'node:stream/promises';import fs from 'node:fs';
const mode=globalThis.sdkStdioMode??p.argv[2];
if(mode==='echo'){
    let count=0,sum=0;for await(const bytes of stdin){count+=bytes.length;for(const value of bytes)sum=(sum+value)>>>0;}
    stdout.write(JSON.stringify({count,sum,identity:stdin===p.stdin&&stdout===p.stdout&&stderr===p.stderr,readable:stdin instanceof Readable,writable:stdout instanceof Writable,fd:[stdin.fd,stdout.fd,stderr.fd],tty:[!!stdin.isTTY,!!stdout.isTTY,!!stderr.isTTY]})+'\n',()=>stderr.write('ACK'));
}else if(mode==='argv'){
    stdout.write(JSON.stringify(p.argv.slice(3)));
}else if(mode==='pipe'){
    stdin.once('end',()=>setImmediate(()=>stderr.write('ENDED:'+stdout.writableEnded)));stdin.pipe(stdout);
}else if(mode==='pipeline'){
    await pipeline(stdin,stdout);stderr.write('ENDED:'+stdout.writableEnded);
}else if(mode==='unref'){
    stdin.resume();stdin.unref();stdout.write('READY\n');
}else if(mode==='ref'){
    stdin.resume();stdin.unref();stdin.ref();stdin.once('end',()=>stdout.write('DONE\n'));stdout.write('READY\n');
}else if(mode==='broken'){
    stdout.on('error',()=>{});stdin.once('data',()=>stdout.write(Buffer.alloc(65536,1),e=>stderr.write('ERROR '+JSON.stringify(e?{name:e.name,code:e.code,syscall:e.syscall}:null)+'\n')));stderr.write('READY\n');
}
