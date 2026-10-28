import http from 'node:http';import {httpService} from './fixtures/http-service.mjs';import {result} from './fixtures/result.mjs';
const service=await httpService(),out={},agent=new http.Agent({keepAlive:true,maxSockets:1});
const options={host:'127.0.0.1',port:service.port,agent};
try{
    let open;const firstResponse=new Promise(resolve=>open=resolve),firstDone=new Promise((resolve,reject)=>{const req=http.get({...options,path:'/slow'},res=>{res.on('data',()=>{});open();res.on('end',resolve);});req.on('error',reject);});await firstResponse;
    const controller=new AbortController();out.queuedAbort=await new Promise(resolve=>{const req=http.get({...options,path:'/echo',signal:controller.signal});const trace=[];req.on('socket',()=>trace.push('socket'));req.on('error',e=>trace.push([e.name,e.code]));req.on('close',()=>resolve(trace));controller.abort();});await firstDone;
    out.afterQueue=await new Promise((resolve,reject)=>{const req=http.get({...options,path:'/echo'},res=>{res.resume();res.on('end',()=>resolve([res.statusCode,req.reusedSocket]));});req.on('error',reject);});
    for(const [name,path]of [['duplicate','/badcl'],['chunk','/badchunk']])out[name]=await new Promise(resolve=>{let failure;const req=http.get({...options,agent:false,port:service.raw,path},res=>{res.on('data',()=>{});res.on('error',e=>failure=e.code);res.on('close',()=>resolve(failure));});req.on('error',e=>{failure=e.code;resolve(failure);});});
    out.timeout=await new Promise(resolve=>{const trace=[],req=http.get({...options,agent:false,path:'/stall'});req.on('socket',socket=>socket.once('connect',()=>req.setTimeout(25,()=>{trace.push('timeout');req.destroy(new Error('stop'));})));req.on('error',e=>trace.push(e.message));req.on('close',()=>resolve(trace));});
    out.stream=await new Promise((resolve,reject)=>{const req=http.request({...options,agent:false,path:'/echo',method:'POST'},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks).toString())));});req.on('error',reject);req.write('a');req.write('');req.end('b');});
    out.url=await new Promise((resolve,reject)=>{http.get(new URL('http://127.0.0.1:'+service.port+'/echo'),{agent:false},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks).toString())));}).on('error',reject);});
    result(out);
}finally{agent.destroy();await service.close();}
