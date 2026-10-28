import {lookup} from 'node:dns/promises';
import {connect} from 'node:net';
import {URL} from 'node:url';
import * as os from 'os';
os.Worker.parent.onmessage=async({data})=>{
    try{
        const host=await lookup('localhost',{family:4});
        const socket=connect({host:host.address,port:data}),parts=[];
        socket.on('data',chunk=>parts.push(chunk));
        await new Promise((resolve,reject)=>{socket.on('error',reject);socket.on('connect',()=>socket.end('worker 网络'));socket.on('close',resolve);});
        os.Worker.parent.postMessage({echo:Buffer.concat(parts).toString(),url:new URL('../worker?中=文','http://EXAMPLE.com:80/a/b').href});
    }catch(e){os.Worker.parent.postMessage({error:String(e)});}
    os.Worker.parent.onmessage=null;
};
