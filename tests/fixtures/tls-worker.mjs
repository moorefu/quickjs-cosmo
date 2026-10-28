import tls from 'node:tls';import fs from 'node:fs';import * as os from 'os';
os.Worker.parent.onmessage=async()=>{
    try{
        const socket=tls.connect({host:'127.0.0.1',port:Number(process.env.NODE_COMPAT_TLS_PORT),servername:'localhost',ca:fs.readFileSync(process.env.NODE_COMPAT_TLS_CA)}),parts=[];
        socket.on('data',chunk=>parts.push(chunk));
        await new Promise((resolve,reject)=>{socket.on('error',reject);socket.on('secureConnect',()=>socket.end('TLS Worker 中文'));socket.on('close',resolve);});
        os.Worker.parent.postMessage({authorized:socket.authorized,echo:Buffer.concat(parts).toString()});
    }catch(e){os.Worker.parent.postMessage({error:String(e)});}
    os.Worker.parent.onmessage=null;
};
