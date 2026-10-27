import {Readable,Writable,Transform,PassThrough,finished,addAbortSignal} from 'node:stream';
import sp from 'node:stream/promises';
import assert from 'node:assert/strict';
const output={},sleep=()=>new Promise(resolve=>setTimeout(resolve,2));
{
    const problem=Object.assign(new Error('manual'),{code:'E_CUSTOM'}),w=new Writable({autoDestroy:false,write(c,e,cb){cb(problem);}});
    const done=sp.finished(w,{cleanup:true}).catch(e=>e.code);w.end('x');const code=await done;output.manualError=[code,w.destroyed,w.closed,w.writable];w.destroy();await sleep();
}
const capture=e=>({name:e.name,code:e.code??null,message:e.message});
for(const stage of ['read','write','transform','final','flush','construct']) {
    const e=new Error('failure-'+stage),events=[];
    const source=new Readable({read(){if(stage==='read')this.destroy(e);else {this.push('x');this.push(null);}}});
    const middle=new Transform({transform(c,enc,cb){cb(stage==='transform'?e:null,c);},flush(cb){cb(stage==='flush'?e:null);}});
    const sink=new Writable({construct(cb){cb(stage==='construct'?e:null);},write(c,enc,cb){cb(stage==='write'?e:null);},final(cb){cb(stage==='final'?e:null);}});
    for(const [name,s] of [['r',source],['t',middle],['w',sink]]){s.on('error',value=>events.push(name+':'+(value===e)));s.on('close',()=>events.push(name+':close'));}
    let caught;try{await sp.pipeline(source,middle,sink);}catch(value){caught=value;}
    await sleep();output[stage]={same:caught===e,destroyed:[source.destroyed,middle.destroyed,sink.destroyed],closed:[source.closed,middle.closed,sink.closed],noFinish:!sink.writableFinished,oneErrorEach:['r','t','w'].map(name=>events.filter(e=>e===name+':true').length)};
}
{
    const events=[];const w=new Writable({write(c,e,cb){setTimeout(cb,10);}});w.on('error',e=>events.push(['error',e.code]));w.on('close',()=>events.push(['close']));w.write('a',e=>events.push(['a',e?.code??null]));w.write('b',e=>events.push(['b',e?.code??null]));w.end(e=>events.push(['end',e?.code??null]));w.destroy(new Error('stop'));await sleep();await new Promise(resolve=>setTimeout(resolve,15));output.destroy={callbacks:events.filter(e=>['a','b','end'].includes(e[0])).map(e=>e[0]),errors:events.filter(e=>e[0]==='error').length,closes:events.filter(e=>e[0]==='close').length};
}
{
    const r=new Readable({read(){}});const result=sp.finished(r,{cleanup:true}).catch(e=>e.code);r.destroy();output.premature=await result;
    const manual=new Readable({read(){}});const before=manual.listenerCount('error'),cleanup=finished(manual,()=>{});const during=manual.listenerCount('error');cleanup();output.cleanup=[before,during,manual.listenerCount('error')];manual.destroy();
}
{
    const controller=new AbortController(),r=new PassThrough(),w=new Writable({write(c,e,cb){cb();}});const p=sp.pipeline(r,w,{signal:controller.signal}).catch(capture);controller.abort('reason');const value=await p;await sleep();output.abort={name:value.name,code:value.code,destroyed:[r.destroyed,w.destroyed],closed:[r.closed,w.closed]};
    const c=new AbortController(),r2=new Readable({read(){}});const p2=sp.finished(r2,{signal:c.signal,cleanup:true}).catch(e=>[e.name,e.code,e.cause]);c.abort('observe');output.observeAbort=[await p2,r2.destroyed];r2.destroy();
    const c3=new AbortController(),r3=new Readable({read(){}});const p3=sp.finished(r3,{cleanup:true}).catch(e=>[e.name,e.code,e.cause]);output.addReturn=addAbortSignal(c3.signal,r3)===r3;c3.abort('attached');output.attached=await p3;
}
{
    const w=new Writable({write(c,e,cb){cb();}});const result=sp.finished(w,{cleanup:true}).catch(e=>e.code);w.end();let cb;w.write('after',e=>cb=e.code);output.afterEnd=[await result,cb];
    const r=new Readable({read(){}});const p=sp.finished(r,{cleanup:true}).catch(e=>e.code);r.push(null);r.push('after');output.afterEOF=await p;
}
{
    const controller=new AbortController();controller.abort('before');const r=new Readable({signal:controller.signal,read(){throw new Error('must not read');}});output.preAbort=await sp.finished(r,{cleanup:true}).catch(e=>[e.name,e.code]);
    const r2=new Readable({construct(cb){setTimeout(cb,2);},destroy(e,cb){cb(e);},read(){}});const promise=sp.finished(r2,{cleanup:true}).catch(e=>e.code);r2.destroy();output.constructDestroy=await promise;
}
assert.equal(output.read.same,true);assert.equal(output.write.same,true);
{
    const streams=[new Readable({read(){this.destroy(new Error('slow-destroy'));},destroy(e,cb){setTimeout(()=>cb(e),3);}}),new PassThrough({destroy(e,cb){setTimeout(()=>cb(e),6);}}),new Writable({write(c,e,cb){cb();},destroy(e,cb){setTimeout(()=>cb(e),9);}})];
    await sp.pipeline(...streams).catch(()=>{});output.delayedDestroy=streams.map(s=>s.closed);
    const errors=[];for(const operation of [()=>new Writable().write(null),()=>new Writable().write(1),()=>new Readable({highWaterMark:-1}),()=>new Readable().setEncoding('bad'),()=>addAbortSignal(undefined,new Readable())])try{operation();}catch(e){errors.push([e.name,e.code]);}output.validation=errors;
}
{
    let reads=0;const r=new Readable({read(){if(++reads<100)this.push(Buffer.alloc(0));}});r.resume();await sleep();output.emptyChunkBounded=reads<10;r.destroy();
    const w=new Writable({write(c,e,cb){cb();cb();}});output.doubleCallback=await new Promise(resolve=>{w.on('error',e=>resolve(e.code));w.write('x');});
}
{
    const events=[],r=new Readable({read(){},destroy(e,cb){setTimeout(()=>cb(e),4);}});r.on('error',()=>events.push('error'));r.on('close',()=>events.push('close'));r.destroy(new Error('before-observe'));
    await sp.finished(r,{cleanup:true}).catch(()=>events.push('finished'));await sleep();output.observeDestroyed=events;
    const immediate=new Readable({read(){}});immediate.destroy();output.closedImmediate=[immediate.destroyed,immediate.closed];
}
console.log('NODE_COMPAT_RESULT '+JSON.stringify(output));
