import {httpService} from './fixtures/http-service.mjs';import {result,check} from './fixtures/result.mjs';
const service=await httpService(),base='http://127.0.0.1:'+service.port,out={};
try{
    let response=await fetch(base+'/echo');out.get=[response.status,response.statusText,response.type,response.redirected,response.url===base+'/echo',response.body instanceof ReadableStream,response.bodyUsed,await response.json(),response.bodyUsed];
    response=await fetch(base+'/echo',{method:'POST',body:'hello 中文',headers:{'X-Custom':'value'}});out.post=await response.json();
    response=await fetch(base+'/chunk');const clone=response.clone();const reader=response.body.getReader();let length=0,typed=true;for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;typed&&=next.value instanceof Uint8Array&&!Buffer.isBuffer(next.value);}reader.releaseLock();out.chunk=[length,typed,await clone.text().then(s=>[s.length,s.slice(-5)]),response.headers.getSetCookie()];
    response=await fetch(base+'/gzip');out.gzip=[response.headers.get('content-encoding'),await response.text()];
    response=await fetch(base+'/redirect',{method:'POST',body:'drop me',headers:{'content-type':'text/custom'}});out.redirect=[response.redirected,response.url===base+'/echo',await response.json()];
    response=await fetch(base+'/redirect',{redirect:'manual'});out.manual=[response.status,response.redirected,response.headers.get('location')];await response.body.cancel();
    out.redirectError=await fetch(base+'/redirect',{redirect:'error'}).then(()=>false,e=>e.name);
    response=await fetch(base+'/empty');out.empty=[response.body,await response.text(),response.bodyUsed];
    const controller=new AbortController();controller.abort('cancelled');out.preAbort=await fetch(base+'/echo',{signal:controller.signal}).then(()=>false,e=>e);
    const req=new Request(base+'/echo',{method:'POST',body:new ReadableStream({start(c){c.enqueue(new Uint8Array([65,66]));c.close();}}),duplex:'half'});out.streamUpload=[await fetch(req).then(r=>r.json()),req.bodyUsed];
    out.immutable=await fetch(base+'/empty').then(r=>{try{r.headers.set('a','b');return false;}catch(e){return e.name;}});
    result(out);
}finally{await service.close();}
