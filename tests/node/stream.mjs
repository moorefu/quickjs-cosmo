import Stream,{Readable,Writable,Duplex,Transform,PassThrough,pipeline,finished,promises} from 'node:stream';
import * as bare from 'stream';
import sp from 'node:stream/promises';
import assert from 'node:assert/strict';
const output={identity:bare.default===Stream && Stream.Readable===Readable && promises===sp};
{
    class Child extends Writable {}
    function Legacy(){Writable.call(this,{write(c,e,cb){cb();}});}
    Object.setPrototypeOf(Legacy.prototype,Writable.prototype);const legacy=new Legacy();legacy.end();await sp.finished(legacy,{cleanup:true});
    output.inheritance=[new Writable() instanceof Child,legacy instanceof Writable,legacy instanceof Legacy,legacy.writableFinished];
}
const sleep=()=>new Promise(resolve=>setTimeout(resolve,1));
const pipe=(...streams)=>new Promise((resolve,reject)=>pipeline(...streams,e=>e?reject(e):resolve()));
{
    const chunks=[],events=[];let counter=0,active=0,maxActive=0;
    const source=new Readable({objectMode:true,highWaterMark:2,read(){while(counter<12)if(!this.push(counter++))return;this.push(null);}});
    const transform=new Transform({objectMode:true,highWaterMark:1,transform(value,encoding,cb){cb(null,value*3);},flush(cb){this.push(99);cb();}});
    const sink=new Writable({objectMode:true,highWaterMark:1,write(value,encoding,cb){active++;maxActive=Math.max(maxActive,active);setTimeout(()=>{chunks.push(value);active--;cb();},1);},final(cb){events.push('final');cb();}});
    sink.on('drain',()=>events.push('drain'));sink.on('finish',()=>events.push('finish'));sink.on('close',()=>events.push('close'));
    output.pipelineReturn=pipeline(source,transform,sink,e=>{if(e)throw e;})===sink;
    await sp.finished(sink,{cleanup:true});
    output.objects={chunks,maxActive,finalBeforeFinish:events.indexOf('final')<events.indexOf('finish'),finishBeforeClose:events.indexOf('finish')<events.indexOf('close'),drain:events.includes('drain'),closed:[source.closed,transform.closed,sink.closed]};
}
{
    const events=[];const w=new Writable({highWaterMark:3,write(c,e,cb){events.push(['write',c.toString(),e]);setTimeout(cb,1);}});
    w.on('drain',()=>events.push('drain'));w.on('finish',()=>events.push('finish'));w.on('close',()=>events.push('close'));
    const first=w.write('ab',()=>events.push('cb1')),second=w.write(Buffer.from('cd'),()=>events.push('cb2'));
    const queued=[w.writableLength,w.writableNeedDrain,w.writableHighWaterMark];await new Promise(resolve=>w.once('drain',resolve));
    w.end('e',()=>events.push('endcb'));await sp.finished(w,{cleanup:true});
    output.backpressure={first,second,queued,events,final:[w.writableLength,w.writableEnded,w.writableFinished,w.destroyed]};
}
{
    const batches=[],callbacks=[];const w=new Writable({write(c,e,cb){batches.push(c.toString());cb();},writev(chunks,cb){batches.push(chunks.map(c=>[c.chunk.toString(),c.encoding]));cb();}});
    w.cork();w.cork();w.write('a',()=>callbacks.push(1));w.write('b',()=>callbacks.push(2));w.uncork();output.nestedCork=[w.writableCorked,w.writableLength,batches.length];w.uncork();w.end();await sp.finished(w,{cleanup:true});output.batch={batches,callbacks};
    const v=[],only=new Writable({writev(chunks,cb){v.push(chunks.map(c=>c.chunk.toString()));cb();}});only.end('only');await sp.finished(only,{cleanup:true});output.writevOnly=v;
}
{
    const r=new Readable({read(){this.push('sync');this.push(null);}});output.syncRead=r.read().toString();await sp.finished(r,{cleanup:true});
}
{
    const r=new Readable({read(){}});r.push(Buffer.from('abcd'));r.push(Buffer.from('ef'));r.push(null);
    output.read=[r.read(2).toString(),r.read(3).toString(),r.read(3).toString(),r.read()];await sp.finished(r,{cleanup:true});
    const u=new Readable({read(){}});u.push('bc');u.unshift(Buffer.from('a'));output.unshift=u.read().toString();u.push(null);u.resume();await sp.finished(u,{cleanup:true});
}
{
    const chunks=[],w=new Writable({decodeStrings:false,defaultEncoding:'latin1',write(c,e,cb){chunks.push([typeof c,c.toString(),e]);cb();}});w.write('é');w.setDefaultEncoding('utf8');w.end('中');await sp.finished(w,{cleanup:true});output.encodings=chunks;
}
{
    const d=new Duplex({allowHalfOpen:false,read(){this.push('r');this.push(null);},write(c,e,cb){cb();}});const events=[];d.on('end',()=>events.push('end'));d.on('finish',()=>events.push('finish'));d.resume();await sp.finished(d,{cleanup:true});output.duplex={events,instance:[d instanceof Readable,d instanceof Writable,d instanceof Duplex],allowHalfOpen:d.allowHalfOpen};
    const half=new Duplex({read(){this.push(null);},write(c,e,cb){cb();}});half.resume();await new Promise(resolve=>half.once('end',resolve));output.half=[half.writable,half.destroyed];half.end();await sp.finished(half,{cleanup:true});
}
{
    const p=new PassThrough({highWaterMark:2});const result=[];const consume=(async()=>{for await(const chunk of p)result.push(chunk);})();p.end(Buffer.from('123456'));await consume;output.pass=Buffer.concat(result).toString();
    const source=Readable.from(['a','b','c'],{objectMode:false});const data=[];await pipe(source,new Writable({write(c,e,cb){data.push(c);cb();}}));output.bytes=Buffer.concat(data).toString();
}
{
    const source=new Readable({objectMode:true,read(){}}),a=[],b=[];
    const one=new Writable({objectMode:true,highWaterMark:1,write(c,e,cb){a.push(c);setTimeout(cb,1);}}),two=new Writable({objectMode:true,highWaterMark:1,write(c,e,cb){b.push(c);setTimeout(cb,2);}});
    source.pipe(one);source.pipe(two);source.push(1);source.push(2);source.push(null);await Promise.all([sp.finished(one,{cleanup:true}),sp.finished(two,{cleanup:true})]);output.fanout=[a,b];
    const hold=new PassThrough({objectMode:true}),sink=new Writable({objectMode:true,write(c,e,cb){cb();}});hold.pipe(sink,{end:false});hold.end('x');hold.resume();await sp.finished(hold,{cleanup:true});output.pipeNoEnd=[sink.writable,sink.destroyed];sink.end();await sp.finished(sink,{cleanup:true});
}
{
    const events=[];const w=new Writable({construct(cb){events.push('construct');setTimeout(cb,1);},write(c,e,cb){events.push(c.toString());cb();},destroy(e,cb){events.push('destroy');setTimeout(()=>cb(e),1);}});w.end('data');await sp.finished(w,{cleanup:true});output.construct=events;
    const w2=new Writable({autoDestroy:false,write(c,e,cb){cb();}});w2.end();await sp.finished(w2,{cleanup:true});output.manual=[w2.destroyed,w2.closed,w2.writableFinished];w2.destroy();await sleep();
}
assert.equal(output.objects.chunks.length,13);assert.equal(JSON.stringify(output.fanout),'[[1,2],[1,2]]');
console.log('NODE_COMPAT_RESULT '+JSON.stringify(output));
