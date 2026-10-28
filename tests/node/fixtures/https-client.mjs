import https from 'node:https';import bare from 'https';import http from 'node:http';import {TLSSocket} from 'node:tls';import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
const port=Number(process.env.NODE_COMPAT_HTTPS_PORT),base='https://localhost:'+port,ca=readFileSync(process.env.NODE_COMPAT_HTTPS_CA),out={};
const lookup=(host,options,callback)=>{if(options.all)callback(null,[{address:'127.0.0.1',family:4}]);else callback(null,'127.0.0.1',4);};
const request=(options,body)=>new Promise((resolve,reject)=>{const req=https.request({...options,...(body===undefined?{}:{method:'POST'}),lookup},res=>{const socket=res.socket,chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>resolve({res,req,socket,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end(body);});
out.alias=https===bare&&(await import('node:https')).default===https;
const agent=new https.Agent({keepAlive:true,maxSockets:1}),options={hostname:'localhost',port,path:'/echo',agent};
try{
    const first=await request(options,'hello');out.message={request:first.req instanceof http.ClientRequest,response:first.res instanceof http.IncomingMessage,tls:first.socket instanceof TLSSocket,authorized:first.socket.authorized,protocol:first.req.protocol,agent:agent instanceof http.Agent,port:agent.defaultPort,body:JSON.parse(first.body.toString())};
    const again=await request(options);out.reuse=again.req.reusedSocket;
    out.explicitCA=(await request({...options,agent:false,ca})).res.statusCode;
    out.caIsolation=await request({...options,ca:readFileSync(join(dirname(process.env.NODE_COMPAT_HTTPS_CA),'p521-ca.pem'))}).then(()=>null,e=>({name:e.name,code:e.code}));
    out.afterCA=(await request(options)).req.reusedSocket;
    out.ip=JSON.parse((await request({...options,hostname:'127.0.0.1',agent:false})).body.toString());
    out.identity=await request({...options,servername:'wrong.invalid'}).then(()=>null,e=>({name:e.name,code:e.code}));
    out.badCert=await request({...options,port:Number(process.env.NODE_COMPAT_HTTPS_BAD),agent:false}).then(()=>null,e=>({name:e.name,code:e.code}));
    for(const [name,module,protocol,other]of [['plain',http,'http:',agent],['secure',https,'https:',new http.Agent()]]){try{module.request({protocol,agent:other});out[name]=null;}catch(e){out[name]=[e.name,e.code];}if(name==='secure')other.destroy();}
    out.fetch=await fetch(base+'/gzip').then(async r=>[r.status,await r.text(),r.redirected]);
    out.redirect=await fetch(base+'/redirect').then(async r=>[r.status,new URL(r.url).pathname,await r.json(),r.redirected]);
    out.downgrade=await fetch(base+'/downgrade',{headers:{authorization:'secret',cookie:'a=1'}}).then(async r=>[r.url.startsWith('http:'),await r.json()]);
    out.upgrade=await fetch('http://127.0.0.1:'+process.env.NODE_COMPAT_HTTPS_PLAIN+'/upgrade').then(async r=>[r.url.startsWith('https:'),await r.json()]);
    out.corrupt=await fetch(base+'/corrupt').then(r=>r.text()).then(()=>null,e=>e.name);
    const controller=new AbortController(),res=await fetch(base+'/stall-body',{signal:controller.signal}),reader=res.body.getReader();out.first=new TextDecoder().decode((await reader.read()).value);controller.abort('https-stop');out.abort=await reader.read().then(()=>null,e=>e);reader.releaseLock();
    out.bytes=(await fetch(base+'/bytes').then(r=>r.bytes())).length;
    for(const mode of ['abort','timeout'])out['handshake-'+mode]=await new Promise((resolve,reject)=>{
        const controller=new AbortController(),trace=[],deadline=setTimeout(()=>reject(Error('Handshake cancellation timeout')),5000);
        const req=https.get({host:'127.0.0.1',port:Number(process.env.NODE_COMPAT_HTTPS_SLOW),agent:false,signal:controller.signal});
        req.on('socket',socket=>socket.once('connect',()=>{trace.push('connect');if(mode==='abort')setTimeout(()=>controller.abort(),25);else req.setTimeout(25,()=>{trace.push('timeout');req.destroy(new Error('https-timeout'));});}));
        req.on('error',e=>trace.push([e.name,e.code??e.message]));req.on('close',()=>{clearTimeout(deadline);resolve(trace);});
    });
    delete process.env.NODE_EXTRA_CA_CERTS;out.caSnapshot=await fetch(base+'/echo').then(r=>r.status);
    console.log('NODE_COMPAT_RESULT '+JSON.stringify(out));
}finally{agent.destroy();}
