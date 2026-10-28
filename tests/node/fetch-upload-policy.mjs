/* Reference observations and project cleanup policy, not a compatibility pass. */
import {httpService} from './fixtures/http-service.mjs';import {result} from './fixtures/result.mjs';
const service=await httpService(),controller=new AbortController();let calls=0,reason;
try{
    const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([65]));},pull(){controller.abort('upload-stop');},cancel(value){calls++;reason=value;}},{highWaterMark:0});
    const outcome=await fetch('http://127.0.0.1:'+service.port+'/echo',{method:'POST',body,duplex:'half',signal:controller.signal}).then(()=>null,e=>e);
    await new Promise(resolve=>setTimeout(resolve,20));result({outcome,cancelCalls:calls,cancelReason:reason??null,locked:body.locked});
}finally{await service.close();}
