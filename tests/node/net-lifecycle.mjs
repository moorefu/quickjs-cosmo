import net from 'node:net';
import {networkService} from './fixtures/network-service.mjs';
import {check,result} from './fixtures/result.mjs';
const service=await networkService(),output={};
try{
    const bytes=Buffer.from(Array.from({length:1024*1024+17},(_,i)=>(i*131+7)&255)),socket=net.connect({host:'127.0.0.1',port:service.ports.echo,highWaterMark:1024}),chunks=[];
    let drains=0,ticks=0;const timer=setInterval(()=>ticks++,1);socket.on('drain',()=>drains++);socket.on('data',chunk=>chunks.push(Buffer.from(chunk)));socket.pause();
    const complete=new Promise((resolve,reject)=>{socket.once('error',reject);socket.once('close',resolve);});
    const accepted=socket.write(bytes,()=>socket.end());setTimeout(()=>socket.resume(),40);await complete;clearInterval(timer);
    check(Buffer.concat(chunks).equals(bytes),'large TCP echo under backpressure');check(ticks>0,'TCP must allow timers');
    output.large=[accepted,drains>0,ticks>0,socket.bytesRead===bytes.length,socket.bytesWritten===bytes.length];
    const half=net.connect({host:'127.0.0.1',port:service.ports.half,allowHalfOpen:true});let text='',writableAfterEnd=false;
    half.setEncoding('utf8');half.on('data',chunk=>text+=chunk);half.on('end',()=>{writableAfterEnd=half.writable;half.end('after-peer-fin');});
    await new Promise((resolve,reject)=>{half.once('error',reject);half.once('close',resolve);});
    output.half=[text,writableAfterEnd,await service.receipt()];
    const controller=new AbortController(),cancelled=net.connect({host:'127.0.0.1',port:service.ports.idle,signal:controller.signal});let failure;
    cancelled.once('connect',()=>controller.abort('cancel TCP'));cancelled.on('error',e=>failure=[e.name,e.code,e.cause]);
    await new Promise(resolve=>cancelled.once('close',resolve));output.abort=[failure,cancelled.destroyed];
    let callback;const pendingController=new AbortController(),pending=net.connect({host:'deferred.test',port:service.ports.echo,autoSelectFamily:false,signal:pendingController.signal,lookup(host,options,cb){callback=cb;}});let pendingError,connected=false;
    pending.on('connect',()=>connected=true);pending.on('error',e=>pendingError=[e.name,e.code]);
    const pendingClosed=new Promise(resolve=>pending.once('close',resolve));pendingController.abort();await pendingClosed;callback(null,'127.0.0.1',4);await new Promise(resolve=>setTimeout(resolve,15));
    output.cancelLookup=[pendingError,connected,pending.destroyed];
    const fallback=net.connect({host:'fixture.test',port:service.ports.echo,autoSelectFamily:true,lookup(host,options,cb){queueMicrotask(()=>cb(null,[{address:'::1',family:6},{address:'127.0.0.1',family:4}]));}}),fallbackChunks=[];
    fallback.on('data',chunk=>fallbackChunks.push(chunk));fallback.on('connect',()=>fallback.end('fallback'));
    await new Promise((resolve,reject)=>{fallback.on('error',reject);fallback.on('close',resolve);});
    output.fallback=[Buffer.concat(fallbackChunks).toString(),fallback.remoteAddress,fallback.autoSelectFamilyAttemptedAddresses.length];
    output.concurrent=await Promise.all(Array.from({length:4},(_,i)=>new Promise((resolve,reject)=>{
        const socket=net.connect({host:'127.0.0.1',port:service.ports.echo}),chunks=[];socket.on('error',reject);socket.on('data',c=>chunks.push(c));socket.on('connect',()=>socket.end(String(i)));socket.on('close',()=>resolve(Buffer.concat(chunks).toString()));
    })));
    const slow=net.connect({host:'127.0.0.1',port:service.ports.idle});slow.on('error',()=>{});let timerProgress=false;
    slow.on('connect',()=>{slow.write(Buffer.alloc(16*1024*1024));setTimeout(()=>{timerProgress=true;slow.destroy();},50);});
    await new Promise(resolve=>slow.on('close',resolve));output.slowCancel=[timerProgress,slow.destroyed];
    const reset=net.connect({host:'127.0.0.1',port:service.ports.reset});let resetError=false;
    reset.on('error',e=>{check(['ECONNRESET','EPIPE'].includes(e.code),'reset socket error');resetError=true;});
    reset.on('connect',()=>reset.write(Buffer.alloc(2*1024*1024)));
    await new Promise(resolve=>reset.once('close',resolve));output.reset=resetError;
    result(output);
}finally{await service.close();}
