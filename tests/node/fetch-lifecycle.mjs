import {httpService} from './fixtures/http-service.mjs';import {result} from './fixtures/result.mjs';
const service=await httpService(),base='http://127.0.0.1:'+service.port,out={};
try{
    for(const path of ['/deflate','/raw-deflate'])out[path]=await fetch(base+path).then(r=>r.text());
    out.corrupt=await fetch(base+'/corrupt').then(r=>r.text()).then(()=>false,e=>[e.name,e.code??null]);
    out.truncated=await fetch('http://127.0.0.1:'+service.raw+'/early').then(r=>r.text()).then(()=>false,e=>[e.name,e.code??null]);
    const controller=new AbortController(),response=await fetch(base+'/stall-body',{signal:controller.signal}),reader=response.body.getReader();const first=await reader.read();controller.abort('body-stop');out.bodyAbort=[new TextDecoder().decode(first.value),await reader.read().then(()=>false,e=>[e.name,e.code??null]),response.bodyUsed];reader.releaseLock();
    const cancelled=await fetch(base+'/stall-body');await cancelled.body.cancel('discard');out.cancel=[cancelled.bodyUsed,cancelled.body.locked];
    out.redirect307=await fetch(base+'/redirect307',{method:'POST',body:'again'}).then(r=>r.json());
    out.loop=await fetch(base+'/loop').then(()=>false,e=>e.name);
    out.cross=await fetch(base+'/cross',{headers:{authorization:'secret',cookie:'secret'}}).then(r=>r.json());
    const uploadController=new AbortController();let reason;
    const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([65]));},pull(){uploadController.abort('upload-stop');},cancel(value){reason=value;}},{highWaterMark:0});
    out.uploadAbort=await fetch(base+'/echo',{method:'POST',body,duplex:'half',signal:uploadController.signal}).then(()=>false,e=>e);
    // Source cancel callbacks/locks are retained in fetch-upload-policy.mjs as
    // a documented divergence, rather than normalized in this comparison.
    const results=await Promise.all(Array.from({length:6},(_,i)=>fetch(base+'/echo?i='+i).then(r=>r.json()).then(v=>v.path)));out.concurrent=results;
    for(const clone of [false,true]){const c=new AbortController(),r=await fetch(base+'/echo',{signal:c.signal}),copy=clone?r.clone():null;await new Promise(resolve=>setTimeout(resolve,100));c.abort('late-stop');out['late-'+clone]=await r.text().then(()=>null,e=>[typeof e,e?.name??e]);if(copy)out.lateClone=await copy.text().then(()=>null,e=>[typeof e,e?.name??e]);}
    result(out);
}finally{await service.close();}
