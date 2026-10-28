import http from 'node:http';import bare from 'http';import {Writable,Readable} from 'node:stream';
import {httpService} from './fixtures/http-service.mjs';import {check,result,errorOf} from './fixtures/result.mjs';
const service=await httpService(),out={identity:http===bare&&(await import('node:http')).default===http};
function call(path,{raw=false,method='GET',body,headers,agent=false,pause=false}={}){
    return new Promise((resolve,reject)=>{const trace=[],req=http.request({host:'127.0.0.1',port:raw?service.raw:service.port,path,method,headers,agent},res=>{
        const parts=[];trace.push('response');const meta=[res instanceof http.IncomingMessage,res instanceof Readable,res.statusCode,res.statusMessage,res.httpVersion,res.httpVersionMajor,res.httpVersionMinor];
        res.on('data',c=>parts.push(c));res.on('aborted',()=>trace.push('aborted'));res.on('error',e=>trace.push(e.code));res.on('end',()=>trace.push('end'));res.on('close',()=>resolve({meta,trace,body:Buffer.concat(parts).toString(),headers:{custom:res.headers['x-case']??null,cookie:res.headers['set-cookie']??null,bytes:res.headers['x-bytes']??null},trailers:res.trailers,complete:res.complete,aborted:res.aborted,reused:req.reusedSocket,classes:req instanceof Writable&&req instanceof http.ClientRequest}));
        if(pause){res.pause();setTimeout(()=>res.resume(),25);}
    });req.on('error',reject);req.on('continue',()=>trace.push('continue'));req.on('information',info=>trace.push('info:'+info.statusCode));if(body!==undefined)req.end(body);else req.end();});
}
try{
    out.get=await call('/echo');out.post=await call('/echo',{method:'post',body:'hello 中文',headers:{'X-Custom':['a','b'],Cookie:['a=1','b=2']}});
    out.empty=await call('/empty');const chunks=await call('/chunk',{pause:true});chunks.body=[chunks.body.length,chunks.body.slice(-5)];out.chunk=chunks;
    out.eof=await call('/eof',{raw:true});out.obs=await call('/obs',{raw:true});out.info=await call('/info',{raw:true});out.early=await call('/early',{raw:true});
    const agent=new http.Agent({keepAlive:true,maxSockets:1});try{const first=await call('/echo',{agent}),second=await call('/echo',{agent});out.reuse=[first.reused,second.reused,first.complete&&second.complete];}finally{agent.destroy();}
    out.validation={name:errorOf(()=>http.validateHeaderName('a b')),value:errorOf(()=>http.validateHeaderValue('x','a\r\nb')),protocol:errorOf(()=>http.request('ftp://localhost/')),method:errorOf(()=>http.request({method:'BAD METHOD'}))};
    result(out);
}finally{await service.close();}
