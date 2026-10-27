/* Node-style streams. State is per instance; hooks execute only on its JS thread. */
function createStreams(process) {
    const readers=new WeakMap(),writers=new WeakMap(),states=new WeakMap();
    const tick=(fn,...args)=>process.nextTick(fn,...args);
    const error=(code,message=code)=>codedError(Error,code,message);
    function options(value) {if(value==null)return {};if(typeof value!=='object')throw invalidType('options','an object');return value;}
    function signal(value) {if(value!==undefined && (!value || typeof value.aborted!=='boolean' || typeof value.addEventListener!=='function' || typeof value.removeEventListener!=='function'))throw invalidType('signal','an AbortSignal');return value;}
    function aborted(value) {const e=error('ABORT_ERR','The operation was aborted');e.name='AbortError';if(value)e.cause=value.reason;return e;}
    function hook(stream,method,args,done) {
        let called=false;
        function callback(...values){if(called){errorOrDestroy(stream,error('ERR_MULTIPLE_CALLBACK'));return;}called=true;done(...values);}
        try{Reflect.apply(method,stream,[...args,callback]);}catch(e){if(called)throw e;callback(e);}
    }
    function Stream() {if(!this || this===globalThis)return new Stream();EventEmitter.call(this);}
    Object.setPrototypeOf(Stream.prototype,EventEmitter.prototype);Object.setPrototypeOf(Stream,EventEmitter);
    function init(stream,opts) {
        if(states.has(stream))return states.get(stream);
        const state={destroyed:false,closed:false,error:null,errorEmitted:false,autoDestroy:opts.autoDestroy!==false,emitClose:opts.emitClose!==false,constructing:false,destroyCalled:false,abortCleanups:[]};
        states.set(stream,state);
        for(const name of ['construct','destroy'])if(opts[name]!==undefined){if(typeof opts[name]!=='function')throw invalidType('options.'+name,'a function');stream['_'+name]=opts[name];}
        if(typeof stream._construct==='function') {
            state.constructing=true;
            tick(()=>hook(stream,stream._construct,[],e=>{state.constructing=false;if(e)stream.destroy(e);if(state.destroyed)destroyNow(stream);else {requestRead(stream);drainWrites(stream);finishWrite(stream);}}));
        }
        if(opts.signal!==undefined)addAbortSignal(opts.signal,stream);
        return state;
    }
    function highWaterMark(opts,side,objectMode) {
        const value=opts.highWaterMark??opts[side+'HighWaterMark'];
        if(value===undefined)return objectMode?16:process.platform==='win32'?16384:65536;
        if(typeof value!=='number' || !Number.isSafeInteger(value) || value<0)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid highWaterMark');return value;
    }
    function destroyNow(stream) {
        const state=states.get(stream);if(state.constructing || state.destroyCalled)return;state.destroyCalled=true;
        hook(stream,stream._destroy,[state.error],e=>{
            state.error=e??state.error;
            state.closed=true;for(const cleanup of state.abortCleanups.splice(0))cleanup();
            tick(()=>{
                const w=writers.get(stream),failure=state.error??error('ERR_STREAM_DESTROYED');
                if(w){for(const entry of [...(w.active?.entries??[]),...w.queue])completeEntry(entry,failure);w.queue=[];w.length=0;for(const cb of w.endCallbacks.splice(0))cb(failure);for(const cb of w.idle.splice(0))cb(failure);}
                if(state.error && !state.errorEmitted){state.errorEmitted=true;stream.emit('error',state.error);}
                if(state.emitClose)stream.emit('close');
            });
        });
    }
    Stream.prototype._destroy=function(e,callback){callback(e);};
    Stream.prototype.destroy=function(e){
        const state=states.get(this);if(!state || state.destroyed)return this;
        state.destroyed=true;if(e)state.error=e;
        const r=readers.get(this);if(r){r.queue=[];r.length=0;r.flowing=false;}
        destroyNow(this);return this;
    };
    function errorOrDestroy(stream,e) {
        const state=states.get(stream);if(state.destroyed)return;if(state.autoDestroy){stream.destroy(e);return;}if(state.error)return;state.error=e;
        tick(()=>{const w=writers.get(stream);if(w){for(const entry of [...(w.active?.entries??[]),...w.queue])completeEntry(entry,e);w.active=null;w.queue=[];w.length=0;for(const cb of w.endCallbacks.splice(0))cb(e);for(const cb of w.idle.splice(0))cb(e);}if(!state.errorEmitted){state.errorEmitted=true;stream.emit('error',e);}});
    }
    Object.defineProperties(Stream.prototype,{
        destroyed:{get(){return states.get(this)?.destroyed??false;}},closed:{get(){return states.get(this)?.closed??false;}},
        errored:{get(){return states.get(this)?.error??null;}}
    });
    class Decoder {
        constructor(encoding){this.encoding=normalizeEncoding(encoding);if(!this.encoding)throw codedError(TypeError,'ERR_UNKNOWN_ENCODING','Unknown encoding');this.pending=Buffer.alloc(0);}
        write(value,final=false){
            const bytes=Buffer.concat([this.pending,Buffer.from(value)]);let length=bytes.length,text;
            if(this.encoding==='utf8'){const result=decodeUtf8(bytes,!final,false);length=result.read;text=result.text;}
            else {
                if(!final && this.encoding==='utf16le'){length-=length%2;if(length>=2 && (bytes[length-1]&0xfc)===0xd8)length-=2;}
                if(!final && (this.encoding==='base64' || this.encoding==='base64url'))length-=length%3;
                text=bytes.subarray(0,length).toString(this.encoding);
            }
            this.pending=bytes.subarray(length);return text;
        }
        end(){return this.write(Buffer.alloc(0),true);}
    }
    function Readable(opts) {
        if(!(this instanceof Readable))return new Readable(opts);opts=options(opts);Stream.call(this);
        const objectMode=!!(opts.objectMode||opts.readableObjectMode);
        readers.set(this,{queue:[],length:0,objectMode,hwm:highWaterMark(opts,'readable',objectMode),reading:false,flowing:null,ended:opts.readable===false,endEmitted:opts.readable===false,scheduled:false,flowScheduled:false,readableScheduled:false,endScheduled:false,decoder:null,encoding:null,pipes:new Map(),awaitDrain:new Set()});
        if(opts.read!==undefined){if(typeof opts.read!=='function')throw invalidType('options.read','a function');this._read=opts.read;}
        init(this,opts);if(opts.encoding!==undefined)this.setEncoding(opts.encoding);
    }
    Object.setPrototypeOf(Readable.prototype,Stream.prototype);Object.setPrototypeOf(Readable,Stream);
    Readable.prototype._read=function(){errorOrDestroy(this,error('ERR_METHOD_NOT_IMPLEMENTED','_read() is not implemented'));};
    function pull(stream) {
        const r=readers.get(stream),state=states.get(stream);if(!r || r.reading || r.ended || state.destroyed || state.error || state.constructing || r.length>=r.hwm && r.length>0)return;
        r.reading=true;r.syncReading=true;try{stream._read(r.hwm);}catch(e){errorOrDestroy(stream,e);}finally{r.syncReading=false;}
    }
    function requestRead(stream) {
        const r=readers.get(stream),state=states.get(stream);if(!r || r.scheduled || r.reading || r.ended || state.destroyed || state.constructing)return;
        if(r.length>=r.hwm && r.length>0)return;
        r.scheduled=true;tick(()=>{r.scheduled=false;pull(stream);});
    }
    function readable(stream) {
        const r=readers.get(stream);if(r.readableScheduled)return;r.readableScheduled=true;
        tick(()=>{r.readableScheduled=false;if(!stream.destroyed && (r.length || r.ended))stream.emit('readable');});
    }
    function endReadable(stream) {
        const r=readers.get(stream);if(!r.ended || r.length || r.endEmitted || r.endScheduled)return;r.endScheduled=true;
        tick(()=>{r.endScheduled=false;if(stream.destroyed || !r.ended || r.length || r.endEmitted)return;r.endEmitted=true;stream.emit('end');const w=writers.get(stream);if(w && stream.allowHalfOpen===false && !w.ending)tick(()=>stream.end());autoDestroy(stream);});
    }
    function autoDestroy(stream) {
        const state=states.get(stream),r=readers.get(stream),w=writers.get(stream);
        if(state.autoDestroy && (!r || r.endEmitted) && (!w || w.finished))stream.destroy();
    }
    function flow(stream) {
        const r=readers.get(stream);if(r.flowScheduled)return;r.flowScheduled=true;
        tick(()=>{r.flowScheduled=false;while(r.flowing && !stream.destroyed && stream.read()!==null){}requestRead(stream);});
    }
    function addChunk(stream,chunk,encoding,front) {
        const r=readers.get(stream);if(stream.destroyed)return false;
        if(chunk===null){if(!r.ended){r.reading=false;r.ended=true;if(r.decoder){const tail=r.decoder.end();if(tail){r.queue.push(tail);r.length+=tail.length;}}readable(stream);if(r.flowing)flow(stream);endReadable(stream);}return false;}
        if(front?r.endEmitted:r.ended){errorOrDestroy(stream,error(front?'ERR_STREAM_UNSHIFT_AFTER_END_EVENT':'ERR_STREAM_PUSH_AFTER_EOF'));return false;}
        try {
            if(!r.objectMode){
                if(typeof chunk==='string')chunk=Buffer.from(chunk,encoding);
                else if(ArrayBuffer.isView(chunk))chunk=Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength);
                else throw invalidType('chunk','a string, Buffer, TypedArray or DataView');
                if(r.decoder)chunk=r.decoder.write(chunk);
                if(!chunk.length){if(!front)r.reading=false;return r.length<r.hwm;}
            }
        }catch(e){errorOrDestroy(stream,e);return false;}
        if(!front && r.flowing && !r.length && !r.syncReading){r.reading=false;stream.emit('data',chunk);requestRead(stream);return r.length<r.hwm;}
        if(front)r.queue.unshift(chunk);else {r.queue.push(chunk);r.reading=false;}
        r.length+=r.objectMode?1:chunk.length;readable(stream);if(r.flowing)flow(stream);requestRead(stream);return r.length<r.hwm;
    }
    Readable.prototype.push=function(chunk,encoding){return addChunk(this,chunk,encoding,false);};
    Readable.prototype.unshift=function(chunk,encoding){return addChunk(this,chunk,encoding,true);};
    Readable.prototype.read=function(size) {
        const r=readers.get(this);if(this.destroyed)return null;
        if(size!==undefined){size=Number.parseInt(size,10);if(size<0)size=0;if(Number.isNaN(size))size=undefined;}
        if(size>r.hwm){if(size>0x40000000)throw outOfRange('size');r.hwm=2**Math.ceil(Math.log2(size));}
        if(!r.length || size>r.length || r.length<r.hwm)pull(this);
        if(size===0){requestRead(this);if(r.length || r.ended)readable(this);endReadable(this);return null;}
        if(!r.length){requestRead(this);endReadable(this);return null;}
        if(r.objectMode)size=1;
        else if(size===undefined)size=r.flowing?r.queue[0].length:r.length;
        if(size>r.length && !r.ended){requestRead(this);return null;}
        size=Math.min(size,r.length);let result;
        if(r.objectMode)result=r.queue.shift();
        else if(size===r.queue[0].length)result=r.queue.shift();
        else if(size<r.queue[0].length){const first=r.queue[0];result=typeof first==='string'?first.slice(0,size):first.subarray(0,size);r.queue[0]=typeof first==='string'?first.slice(size):first.subarray(size);}
        else {
            const chunks=[];let remaining=size;
            while(remaining){const first=r.queue[0],amount=Math.min(remaining,first.length);chunks.push(typeof first==='string'?first.slice(0,amount):first.subarray(0,amount));if(amount===first.length)r.queue.shift();else r.queue[0]=typeof first==='string'?first.slice(amount):first.subarray(amount);remaining-=amount;}
            result=r.decoder?chunks.join(''):Buffer.concat(chunks,size);
        }
        r.length-=size;this.emit('data',result);requestRead(this);endReadable(this);return result;
    };
    Readable.prototype.setEncoding=function(encoding){const r=readers.get(this),decoder=new Decoder(encoding),chunks=[];for(const chunk of r.queue){const text=typeof chunk==='string'?chunk:decoder.write(chunk);if(text)chunks.push(text);}r.decoder=decoder;r.encoding=decoder.encoding;r.queue=chunks;r.length=chunks.reduce((sum,s)=>sum+s.length,0);return this;};
    Readable.prototype.pause=function(){const r=readers.get(this);if(r.flowing!==false){r.flowing=false;this.emit('pause');}return this;};
    Readable.prototype.resume=function(){const r=readers.get(this);if(r.flowing!==true){r.flowing=this.listenerCount('readable')===0;tick(()=>{if(!this.destroyed){this.read(0);this.emit('resume');while(r.flowing && !this.destroyed && this.read()!==null){}requestRead(this);}});}return this;};
    Readable.prototype.isPaused=function(){return readers.get(this).flowing===false;};
    Readable.prototype.on=function(type,listener){EventEmitter.prototype.on.call(this,type,listener);const r=readers.get(this);if(type==='data' && r.flowing!==false)this.resume();else if(type==='readable'){r.flowing=false;requestRead(this);if(r.length || r.ended)readable(this);}return this;};
    Readable.prototype.addListener=Readable.prototype.on;
    Readable.prototype.removeListener=function(type,listener){EventEmitter.prototype.removeListener.call(this,type,listener);if(type==='readable' && !this.listenerCount('readable') && this.listenerCount('data'))tick(()=>this.resume());return this;};
    Readable.prototype.off=Readable.prototype.removeListener;
    Object.defineProperties(Readable.prototype,{
        readable:{get(){return !this.destroyed && !this.errored && !readers.get(this).endEmitted;}},readableEnded:{get(){return readers.get(this).endEmitted;}},
        readableLength:{get(){return readers.get(this).length;}},readableHighWaterMark:{get(){return readers.get(this).hwm;}},
        readableObjectMode:{get(){return readers.get(this).objectMode;}},readableEncoding:{get(){return readers.get(this).encoding;}},
        readableFlowing:{get(){return readers.get(this).flowing;},set(value){readers.get(this).flowing=value;}}
    });
    Readable.prototype.pipe=function(destination,opts) {
        opts=options(opts);if(!destination || typeof destination.write!=='function' || typeof destination.on!=='function')throw invalidType('destination','a Writable');
        const source=this,r=readers.get(source);if(r.pipes.has(destination))return destination;
        const data=chunk=>{if(destination.write(chunk)===false){r.awaitDrain.add(destination);source.pause();}};
        const drain=()=>{r.awaitDrain.delete(destination);if(!r.awaitDrain.size && r.pipes.size)source.resume();};
        const end=()=>{if(opts.end!==false)destination.end();else cleanup();};
        const failure=e=>{cleanup();if(!destination.listenerCount('error'))destination.emit('error',e);};
        const cleanup=()=>{if(!r.pipes.delete(destination))return;source.removeListener('data',data);source.removeListener('end',end);source.removeListener('close',cleanup);destination.removeListener('drain',drain);destination.removeListener('finish',cleanup);destination.removeListener('close',cleanup);destination.removeListener('error',failure);r.awaitDrain.delete(destination);destination.emit('unpipe',source,{hasUnpiped:false});if(!r.pipes.size)source.pause();else if(!r.awaitDrain.size)source.resume();};
        r.pipes.set(destination,cleanup);source.on('data',data);source.once('end',end);source.once('close',cleanup);destination.on('drain',drain);destination.once('finish',cleanup);destination.once('close',cleanup);destination.prependListener('error',failure);destination.emit('pipe',source);
        if(r.endEmitted)tick(end);else source.resume();return destination;
    };
    Readable.prototype.unpipe=function(destination){const r=readers.get(this);if(destination)r.pipes.get(destination)?.();else for(const cleanup of [...r.pipes.values()])cleanup();return this;};
    function waitReadable(stream) {
        return new Promise((resolve,reject)=>{
            const cleanup=()=>{for(const [name,fn] of pairs)stream.removeListener(name,fn);};
            const done=()=>{cleanup();resolve();},fail=e=>{cleanup();reject(e);},closed=()=>{if(stream.readableEnded)done();else fail(stream.errored??error('ERR_STREAM_PREMATURE_CLOSE'));};
            const pairs=[['readable',done],['end',done],['error',fail],['close',closed]];for(const [name,fn] of pairs)stream.once(name,fn);
            if(stream.destroyed)tick(closed);
        });
    }
    Readable.prototype.iterator=function(opts) {
        opts=options(opts);const stream=this,destroyOnReturn=opts.destroyOnReturn!==false;
        return (async function*(){
            const swallow=()=>{},hold=()=>{};stream.on('error',swallow);stream.on('readable',hold);
            try {for(;;){if(stream.errored)throw stream.errored;const chunk=stream.read();if(chunk!==null){yield chunk;continue;}if(stream.readableEnded)return;await waitReadable(stream);}}
            finally {stream.removeListener('readable',hold);if(destroyOnReturn && !stream.readableEnded && !stream.destroyed)stream.destroy(aborted());const state=states.get(stream);if(stream.destroyed && (!stream.closed || state.error && !state.errorEmitted))stream.once(state.emitClose?'close':'error',()=>stream.removeListener('error',swallow));else stream.removeListener('error',swallow);}
        })();
    };
    Readable.prototype[Symbol.asyncIterator]=function(){return this.iterator();};
    Readable.from=function(iterable,opts) {
        if(iterable==null)throw invalidType('iterable','an Iterable or AsyncIterable');
        if(typeof iterable==='string' || Buffer.isBuffer(iterable))iterable=[iterable];
        const iterator=iterable[Symbol.asyncIterator]?.()??iterable[Symbol.iterator]?.();if(!iterator || typeof iterator.next!=='function')throw invalidType('iterable','an Iterable or AsyncIterable');
        let pulling=false;
        return new Readable({objectMode:true,...options(opts),read(){if(pulling)return;pulling=true;(async()=>{try{while(!this.destroyed){const next=await iterator.next();if(this.destroyed)break;if(next.done){this.push(null);break;}const value=await next.value;if(value===null)throw error('ERR_STREAM_NULL_VALUES');if(!this.push(value))break;}}catch(e){this.destroy(e);}finally{pulling=false;}})();},destroy(e,callback){Promise.resolve().then(()=>iterator.return?.()).then(()=>callback(e),callback);}});
    };
    function initWritable(stream,opts) {
        const objectMode=!!(opts.objectMode||opts.writableObjectMode);
        writers.set(stream,{queue:[],active:null,length:0,objectMode,hwm:highWaterMark(opts,'writable',objectMode),decodeStrings:opts.decodeStrings!==false,defaultEncoding:normalizeEncoding(opts.defaultEncoding??'utf8'),corked:0,needDrain:false,ending:opts.writable===false,ended:opts.writable===false,finished:opts.writable===false,finalCalled:false,endCallbacks:[],idle:[]});
        if(!writers.get(stream).defaultEncoding)throw codedError(TypeError,'ERR_UNKNOWN_ENCODING','Unknown encoding');
        for(const name of ['write','writev','final'])if(opts[name]!==undefined){if(typeof opts[name]!=='function')throw invalidType('options.'+name,'a function');stream['_'+name]=opts[name];}
        init(stream,opts);
    }
    function Writable(opts) {if(!(this instanceof Writable))return new Writable(opts);opts=options(opts);Stream.call(this);initWritable(this,opts);}
    Object.setPrototypeOf(Writable.prototype,Stream.prototype);Object.setPrototypeOf(Writable,Stream);
    Object.defineProperty(Writable,Symbol.hasInstance,{value(value){return this===Writable && writers.has(value) || Function.prototype[Symbol.hasInstance].call(this,value);}});
    Writable.prototype._write=function(chunk,encoding,callback){callback(error('ERR_METHOD_NOT_IMPLEMENTED','_write() is not implemented'));};
    function completeEntry(entry,e){if(entry.done)return;entry.done=true;entry.callback(e);}
    function drainWrites(stream) {
        const w=writers.get(stream),state=states.get(stream);if(!w || state.constructing || state.destroyed || state.error || w.active || w.corked || !w.queue.length)return;
        const vector=typeof stream._writev==='function' && (w.queue.length>1 || stream._write===Writable.prototype._write);
        const entries=vector?w.queue.splice(0):[w.queue.shift()];
        const active=w.active={entries,length:entries.reduce((n,e)=>n+e.length,0)};let synchronous=true;
        const complete=e=>{
            if(state.destroyed || state.error)return;
            w.active=null;w.length-=active.length;
            if(e){for(const entry of entries)completeEntry(entry,e);errorOrDestroy(stream,e);return;}
            drainWrites(stream);
            if(w.needDrain && !w.length && !w.ending){w.needDrain=false;stream.emit('drain');}
            for(const entry of entries)completeEntry(entry);
            if(!w.length)for(const cb of w.idle.splice(0))cb();
            finishWrite(stream);
        };
        hook(stream,vector?stream._writev:stream._write,vector?[entries.map(e=>({chunk:e.chunk,encoding:e.encoding}))]:[entries[0].chunk,entries[0].encoding],e=>synchronous?tick(complete,e):complete(e));synchronous=false;
    }
    Writable.prototype.write=function(chunk,encoding,callback) {
        const w=writers.get(this);if(typeof encoding==='function'){callback=encoding;encoding=undefined;}callback??=()=>{};if(typeof callback!=='function')throw invalidType('callback','a function');
        if(chunk===null)throw codedError(TypeError,'ERR_STREAM_NULL_VALUES','May not write null values to stream');
        let enc=encoding??w.defaultEncoding;
        if(!w.objectMode){
            if(typeof chunk==='string'){if(!normalizeEncoding(enc))throw codedError(TypeError,'ERR_UNKNOWN_ENCODING','Unknown encoding');if(w.decodeStrings){chunk=Buffer.from(chunk,enc);enc='buffer';}}
            else if(ArrayBuffer.isView(chunk)){chunk=Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength);enc='buffer';}
            else throw invalidType('chunk','a string, Buffer, TypedArray or DataView');
        }
        if(this.destroyed || this.errored || w.ending){const e=this.errored??error(w.ending?'ERR_STREAM_WRITE_AFTER_END':'ERR_STREAM_DESTROYED');tick(callback,e);if(!this.destroyed)errorOrDestroy(this,e);return false;}
        const length=w.objectMode?1:chunk.length;w.length+=length;const result=w.length<w.hwm;if(!result)w.needDrain=true;
        w.queue.push({chunk,encoding:enc,callback,length,done:false});drainWrites(this);return result;
    };
    function finishWrite(stream) {
        const w=writers.get(stream),state=states.get(stream);if(!w || !w.ending || w.finished || w.finalCalled || w.active || w.queue.length || state.destroyed || state.error || state.constructing)return;
        w.finalCalled=true;
        const done=e=>{if(e){errorOrDestroy(stream,e);return;}if(stream.destroyed)return;stream.emit('prefinish');tick(()=>{if(stream.destroyed)return;w.finished=true;for(const cb of w.endCallbacks.splice(0))cb();stream.emit('finish');autoDestroy(stream);});};
        if(typeof stream._final==='function')hook(stream,stream._final,[],done);else tick(done);
    }
    Writable.prototype.end=function(chunk,encoding,callback) {
        if(typeof chunk==='function'){callback=chunk;chunk=undefined;encoding=undefined;}else if(typeof encoding==='function'){callback=encoding;encoding=undefined;}
        if(callback!==undefined && typeof callback!=='function')throw invalidType('callback','a function');
        const w=writers.get(this);if(callback){if(w.finished)tick(callback);else if(this.destroyed)tick(callback,this.errored??error('ERR_STREAM_DESTROYED'));else w.endCallbacks.push(callback);}
        if(chunk!==undefined && chunk!==null)this.write(chunk,encoding);w.ending=true;w.ended=true;w.corked=0;drainWrites(this);finishWrite(this);return this;
    };
    Writable.prototype.cork=function(){writers.get(this).corked++;};
    Writable.prototype.uncork=function(){const w=writers.get(this);if(w.corked)w.corked--;drainWrites(this);};
    Writable.prototype.setDefaultEncoding=function(encoding){const enc=normalizeEncoding(encoding);if(!enc)throw codedError(TypeError,'ERR_UNKNOWN_ENCODING','Unknown encoding');writers.get(this).defaultEncoding=enc;return this;};
    Writable.prototype.pipe=function(){this.destroy(error('ERR_STREAM_CANNOT_PIPE'));};
    Object.defineProperties(Writable.prototype,{
        writable:{get(){const w=writers.get(this);return !this.destroyed && !this.errored && !w.ending;}},writableEnded:{get(){return writers.get(this).ended;}},writableFinished:{get(){return writers.get(this).finished;}},
        writableLength:{get(){return writers.get(this).length;}},writableHighWaterMark:{get(){return writers.get(this).hwm;}},writableObjectMode:{get(){return writers.get(this).objectMode;}},
        writableNeedDrain:{get(){return !this.destroyed && !writers.get(this).ending && writers.get(this).needDrain;}},writableCorked:{get(){return writers.get(this).corked;}}
    });
    function Duplex(opts){if(!(this instanceof Duplex))return new Duplex(opts);opts=options(opts);Readable.call(this,opts);initWritable(this,opts);this.allowHalfOpen=opts.allowHalfOpen!==false;}
    Object.setPrototypeOf(Duplex.prototype,Readable.prototype);Object.setPrototypeOf(Duplex,Readable);
    for(const key of Reflect.ownKeys(Writable.prototype))if(key!=='constructor' && !(key in Duplex.prototype))Object.defineProperty(Duplex.prototype,key,Object.getOwnPropertyDescriptor(Writable.prototype,key));
    function Transform(opts) {
        if(!(this instanceof Transform))return new Transform(opts);opts=options(opts);Duplex.call(this,opts);this._transformPending=null;this._transformHeld=null;this._transforming=false;
        for(const name of ['transform','flush'])if(opts[name]!==undefined){if(typeof opts[name]!=='function')throw invalidType('options.'+name,'a function');this['_'+name]=opts[name];}
    }
    Object.setPrototypeOf(Transform.prototype,Duplex.prototype);Object.setPrototypeOf(Transform,Duplex);
    Transform.prototype._transform=function(chunk,encoding,callback){callback(error('ERR_METHOD_NOT_IMPLEMENTED','_transform() is not implemented'));};
    Transform.prototype._write=function(chunk,encoding,callback){this._transformPending={chunk,encoding,callback};this._read();};
    Transform.prototype._read=function(){
        if(this._transformHeld){const cb=this._transformHeld;this._transformHeld=null;cb();}
        const pending=this._transformPending;if(!pending || this._transforming)return;this._transformPending=null;this._transforming=true;
        hook(this,this._transform,[pending.chunk,pending.encoding],(e,data)=>{this._transforming=false;if(data!==undefined && data!==null)this.push(data);const r=readers.get(this);if(e || this.destroyed || r.length<r.hwm || !r.length)pending.callback(e);else this._transformHeld=pending.callback;});
    };
    Transform.prototype._final=function(callback){const done=(e,data)=>{if(data!==undefined && data!==null)this.push(data);if(!e)this.push(null);callback(e);};if(typeof this._flush==='function')hook(this,this._flush,[],done);else done();};
    function PassThrough(opts){if(!(this instanceof PassThrough))return new PassThrough(opts);Transform.call(this,opts);}
    Object.setPrototypeOf(PassThrough.prototype,Transform.prototype);Object.setPrototypeOf(PassThrough,Transform);
    PassThrough.prototype._transform=function(chunk,encoding,callback){callback(null,chunk);};
    function finished(stream,opts,callback) {
        if(typeof opts==='function'){callback=opts;opts={};}opts=options(opts);if(typeof callback!=='function')throw invalidType('callback','a function');
        if(!states.has(stream))throw invalidType('stream','a Stream');signal(opts.signal);
        const state=states.get(stream),r=readers.get(stream),w=writers.get(stream);let done=false;
        const wantRead=opts.readable!==false && !!r,wantWrite=opts.writable!==false && !!w;
        const cleanup=()=>{stream.removeListener('end',check);stream.removeListener('finish',check);stream.removeListener('error',fail);stream.removeListener('close',close);opts.signal?.removeEventListener('abort',abort);};
        const complete=e=>{if(done)return;done=true;opts.signal?.removeEventListener('abort',abort);if(opts.cleanup)cleanup();callback(e);};
        const check=()=>{if(state.error && opts.error!==false)return;if((!wantRead || r.endEmitted) && (!wantWrite || w.finished) && (!state.autoDestroy || !state.emitClose || state.closed))complete();};
        const fail=e=>{if(opts.error!==false)complete(e);};
        const close=()=>{if((wantRead && !r.endEmitted) || (wantWrite && !w.finished))complete(state.error??error('ERR_STREAM_PREMATURE_CLOSE'));else complete();};
        const abort=()=>complete(aborted(opts.signal));
        stream.on('end',check);stream.on('finish',check);stream.on('error',fail);stream.on('close',close);opts.signal?.addEventListener('abort',abort,{once:true});
        if(opts.signal?.aborted)tick(abort);else if(state.error && state.errorEmitted && opts.error!==false)tick(fail,state.error);else if(state.closed)tick(close);else tick(check);
        return cleanup;
    }
    function pipelineRun(args,opts,callback) {
        if(args.length===1 && Array.isArray(args[0]))args=args[0];if(args.length<2)throw codedError(TypeError,'ERR_MISSING_ARGS','pipeline requires two streams');
        opts=options(opts);signal(opts.signal);if(opts.end===false)throw error('ERR_NOT_SUPPORTED','pipeline end:false is not enabled');
        args=args.slice();if(!states.has(args[0]))args[0]=Readable.from(args[0]);
        for(let i=0;i<args.length;i++)if(!states.has(args[i]) || i<args.length-1 && !readers.has(args[i]) || i>0 && !writers.has(args[i]))throw invalidType('streams','readable and writable streams');
        let remaining=args.length,failure=null,settled=false;
        const abort=()=>fail(aborted(opts.signal));
        const fail=e=>{if(!failure)failure=e;for(const stream of args)if(!stream.destroyed){const r=readers.get(stream),w=writers.get(stream),complete=(!r || r.ended && !r.length) && (!w || w.ending && !w.length);stream.destroy(complete?undefined:failure);}};
        const done=e=>{if(e)fail(e);if(--remaining || settled)return;settled=true;opts.signal?.removeEventListener('abort',abort);tick(callback,failure);};
        args.forEach((stream,i)=>finished(stream,{readable:i<args.length-1,writable:i>0},done));
        opts.signal?.addEventListener('abort',abort,{once:true});
        for(let i=0;i<args.length-1;i++)args[i].pipe(args[i+1]);if(opts.signal?.aborted)tick(abort);
        return args[args.length-1];
    }
    function pipeline(...args){const callback=args.pop();if(typeof callback!=='function')throw invalidType('callback','a function');return pipelineRun(args,{},callback);}
    const promises={finished(stream,opts){return new Promise((resolve,reject)=>finished(stream,opts,e=>e?reject(e):resolve()));},pipeline(...args){let opts={};if(args.length && !states.has(args[args.length-1]) && !Array.isArray(args[args.length-1]) && typeof args[args.length-1]==='object')opts=args.pop();return new Promise((resolve,reject)=>pipelineRun(args,opts,e=>e?reject(e):resolve()));}};
    function addAbortSignal(value,stream){if(value===undefined)throw invalidType('signal','an AbortSignal');signal(value);if(!states.has(stream))throw invalidType('stream','a Stream');const state=states.get(stream),abort=()=>stream.destroy(aborted(value));if(value.aborted)tick(abort);else if(!state.closed){value.addEventListener('abort',abort,{once:true});state.abortCleanups.push(()=>value.removeEventListener('abort',abort));}return stream;}
    if(Symbol.asyncDispose)Stream.prototype[Symbol.asyncDispose]=function(){if(!this.destroyed)this.destroy(aborted());return promises.finished(this,{cleanup:true}).catch(e=>{if(e.code!=='ABORT_ERR')throw e;});};
    const api={Stream,Readable,Writable,Duplex,Transform,PassThrough,pipeline,finished,addAbortSignal,promises};Object.assign(Stream,api);return {api,default:Stream,promises};
}
