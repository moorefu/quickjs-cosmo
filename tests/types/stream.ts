import Stream,{Readable,Writable,Duplex,Transform,PassThrough,pipeline,finished,addAbortSignal} from 'node:stream';
import sp from 'stream/promises';
const readable=new Readable({highWaterMark:8,read(size){this.push(Buffer.alloc(size));this.push(null);}});
const writable=new Writable({write(chunk,encoding,callback){callback();},final(callback){callback();}});
const transform=new Transform({transform(chunk,encoding,callback){callback(null,chunk);},flush(callback){callback();}});
const duplex:Writable=new Duplex({allowHalfOpen:false,read(){this.push(null);},write(chunk,encoding,callback){callback();}});
const sink:Writable=pipeline(readable,transform,writable,error=>{});
const bool:boolean=writable.write('test','utf8',error=>{});
const p:Promise<void>=sp.pipeline(Readable.from([1,2]),new PassThrough({objectMode:true}),writable,{signal:new AbortController().signal});
const cleanup:()=>void=finished(sink,{cleanup:true},error=>{});
const observed:Promise<void>=sp.finished(writable,{cleanup:true});
const same:Readable=addAbortSignal(new AbortController().signal,readable);
const ctor:typeof Readable=Stream.Readable;
const iterator:AsyncIterableIterator<any>=same.iterator({destroyOnReturn:false});
const disposal:Promise<void>=transform[Symbol.asyncDispose]();
// @ts-expect-error unsupported Web Streams conversion
Readable.toWeb(readable);
// @ts-expect-error callback finished requires a callback
finished(readable);
// @ts-expect-error end:false pipeline is not in the implemented subset
sp.pipeline(readable,writable,{end:false});
// @ts-expect-error an encoding must be supported
writable.setDefaultEncoding('bogus');
// @ts-expect-error hooks require callback functions
new Writable({write:5});
